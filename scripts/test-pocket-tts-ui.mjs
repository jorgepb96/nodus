import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { loadTs, loadTsStubbed } from './drift-test-utils.mjs';

const { POCKET_MODEL_ID } = loadTs('shared/pocketTts.ts');

test('Pocket settings install the correct engine, download voices and save uploaded audio without a transcript', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  window.HTMLMediaElement.prototype.pause = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__pocketUiReact = React;
  const calls = [], patches = [];
  const voices = [
    { id: 'pocket:lola', name: 'Lola', origin: 'pocket', language: 'es', readOnly: true, downloaded: false },
    { id: 'pocket:anna', name: 'Anna', origin: 'pocket', language: 'en', readOnly: true, downloaded: false },
  ];
  const runtime = { installed: false, installing: false };
  const status = { platformSupported: true, runtime: { ...runtime, backend: 'mlx' }, phononRuntime: runtime, kokoroRuntime: runtime, pocketRuntime: runtime, models: [{ id: POCKET_MODEL_ID }], engine: { state: 'unloaded' } };
  globalThis.__pocketUiStatus = status;
  window.nodus = {
    ttsHasHuggingFaceToken: async () => true,
    ttsVoices: async () => voices,
    ttsDiskUsage: async () => null,
    ttsInstallRuntime: async engine => { calls.push(['install', engine]); },
    ttsDownloadVoice: async id => { calls.push(['download', id]); voices.find(voice => voice.id === id).downloaded = true; },
    ttsSaveVoice: async input => { calls.push(['save', input]); return { id: 'user:fixture', ...input }; },
  };
  const { NarrationSettings } = await loadTsStubbed('src/views/NarrationSettings.tsx', { stubs: {
    '^react$': 'module.exports = globalThis.__pocketUiReact;',
    '/i18n$': 'exports.t = s => s; exports.tx = s => s;',
    '/components/ui$': 'exports.Icon = () => null;',
    '/ConfirmModal$': 'exports.ConfirmModal = () => null;',
    '/media/LocalAudioRecorder$': 'exports.useLocalAudioRecorder = () => ({state:"idle"}); exports.LocalAudioRecorderPanel = () => null;',
    '/narration/voiceAudio$': 'exports.prepareReferenceAudio = async () => ({durationS:10, wav:new Uint8Array(44)});',
    '/narration/ttsClient$': 'exports.subscribeTtsStatus = cb => { cb(globalThis.__pocketUiStatus); return () => {}; }; exports.subscribeTtsEvents = () => () => {}; exports.refreshTtsStatus = async () => globalThis.__pocketUiStatus;',
  } });
  const root = createRoot(document.getElementById('root'));
  const settings = { audioSpeed: 1, ttsStreaming: true, ttsLanguage: 'auto', ttsIdleUnloadMin: 5, ttsModelId: POCKET_MODEL_ID, ttsPocketVoiceId: 'pocket:lola', ttsAcceptedLicenses: [] };
  try {
    await act(async () => root.render(React.createElement(NarrationSettings, { settings, patch: async value => patches.push(value) })));
    const install = document.querySelector('[data-testid="narration-runtime-pocket"] button');
    await act(async () => install.click());
    assert.deepEqual(calls[0], ['install', 'pocket']);
    const download = document.querySelector('[data-testid="narration-voice-pocket:lola"] button');
    await act(async () => download.click());
    assert.deepEqual(calls[1], ['download', 'pocket:lola']);
    const language = document.querySelector('[data-testid="narration-pocket-language"]');
    await act(async () => { language.value = 'en'; language.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await act(async () => document.querySelector('[data-testid="narration-voice-pocket:anna"] button').click());
    assert.equal(language.value, 'en', 'refreshing downloads preserves the language filter');
    const upload = document.querySelector('[data-testid="narration-voice-new"] input[type=file]');
    Object.defineProperty(upload, 'files', { value: [new window.File(['audio'], 'reference.wav', { type: 'audio/wav' })] });
    await act(async () => upload.dispatchEvent(new window.Event('change', { bubbles: true })));
    const draft = document.querySelector('[data-testid="narration-voice-draft"]');
    assert.ok(draft);
    assert.equal(draft.querySelector('textarea').value, '');
    assert.match(draft.querySelector('textarea').placeholder, /opcional/);
    await act(async () => draft.querySelector('input[type=checkbox]').click());
    const save = [...draft.querySelectorAll('button')].find(button => button.textContent === 'Guardar voz');
    assert.equal(save.disabled, false, 'audio alone is sufficient once consent is given');
    await act(async () => save.click());
    const input = calls.find(([kind]) => kind === 'save')[1];
    assert.equal(input.engine, 'pocket');
    assert.equal(input.transcript, '');
    assert.equal(input.consent, true);
    assert.ok(patches.some(patch => patch.ttsPocketVoiceId === 'user:fixture'));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.__pocketUiReact;
    delete globalThis.__pocketUiStatus;
  }
});
