// The Listen balloon must show that a download or an engine install was actually requested.
// The main process announces installs with `install` events and downloads only once the first
// byte arrives, so a balloon that listened to neither looked inert for minutes.
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { loadTsStubbed } from './drift-test-utils.mjs';

globalThis.__listenFeedbackReact = React;

/** A fresh bundle per case: the renderer's TTS status cache is module state. */
function loadBalloon() {
  return loadTsStubbed('src/components/narration/Listen.tsx', { stubs: {
    '^react$': 'module.exports = globalThis.__listenFeedbackReact;',
    '/i18n$': 'exports.t = (key) => key; exports.tx = (key) => key; exports.getActiveLang = () => "es";',
    '/components/ui$': 'exports.Icon = () => null;',
    '/ConfirmModal$': 'exports.ConfirmModal = () => null;',
    '/HeaderBalloon$': 'const React = globalThis.__listenFeedbackReact; exports.HeaderBalloon = (props) => React.createElement("div", { "data-testid": props.testId }, props.children);',
    '/AudioPlayer$': 'exports.useAudioPlayer = () => ({ source: null, isPlaying: false, timeline: { totalS: 0, playedS: 0, generatedS: 0 }, play: () => {}, stop: () => {}, toggle: () => {}, currentTime: 0, currentTrackId: null, tracks: [], cancelGeneration: () => {} }); exports.useOptionalAudioPlayer = () => null;',
    '/backgroundJobs$': 'exports.audioGenerationJobKey = (kind, id) => kind + ":" + id; exports.cancelAudioGeneration = () => {}; exports.startAudioGeneration = () => ({ id: "job" }); exports.subscribeBackgroundJob = () => () => {};',
    '/narration/narrate$': 'exports.segmentNarrator = () => {}; exports.startNarration = () => {};',
    '/narration/VoicePicker$': 'exports.VoicePicker = () => null;',
  } });
}

const SETTINGS = {
  ttsModelId: 'phonon-31m-en', ttsLanguage: 'auto', ttsVoiceId: 'user:voice',
  ttsPhononVoiceId: 'phonon:iker', ttsKokoroVoiceId: 'kokoro:dora', ttsPocketVoiceId: 'pocket:lola',
  ttsVoiceFilters: {}, ttsStreaming: true, ttsRetention: { enabled: true, days: 7, perSurface: {} },
};

function status({ phononInstalled = false, modelDownloaded = false, downloading = false, progress = 0, engineError = undefined } = {}) {
  return {
    platformSupported: true,
    runtime: { installed: true, installing: false, engine: 'ming', backend: 'mlx' },
    phononRuntime: { installed: phononInstalled, installing: false, engine: 'phonon', backend: 'phonon', ...(engineError ? { error: engineError } : {}) },
    kokoroRuntime: { installed: true, installing: false, engine: 'kokoro', backend: 'kokoro' },
    pocketRuntime: { installed: true, installing: false, engine: 'pocket', backend: 'pocket' },
    models: [
      { id: 'phonon-31m-en', downloaded: modelDownloaded, downloading, downloadedBytes: downloading ? 1024 : 0, totalBytes: 65_000_000, progress },
      { id: 'phonon-40m-es', downloaded: false, downloading: false, downloadedBytes: 0, totalBytes: 75_000_000, progress: 0 },
    ],
    engine: { state: 'unloaded', modelId: null, idleUnloadAt: null },
  };
}

function setupDom() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLMediaElement.prototype.pause = () => {};
  dom.window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  return dom;
}

/** Renders the balloon with a controllable status and event channel; `finish` settles the IPC calls. */
async function mount(dom, initialStatus, modelId = 'phonon-31m-en') {
  const calls = [];
  const pending = {};
  const listeners = [];
  let current = initialStatus;
  window.nodus = {
    getSettings: async () => ({ ...SETTINGS, ttsModelId: modelId }),
    updateSettings: async (patch) => calls.push(['updateSettings', patch]),
    listAudioClips: async () => [],
    ttsStatus: async () => { calls.push(['status']); return current; },
    onTtsEvent: (listener) => { listeners.push(listener); return () => {}; },
    ttsVoices: async () => [],
    ttsInstallRuntime: (engine) => { calls.push(['install', engine]); return new Promise((resolve, reject) => { pending.install = (error) => (error ? reject(error) : resolve(current)); }); },
    ttsCancelInstall: async () => calls.push(['cancelInstall']),
    ttsDownloadModel: (id) => { calls.push(['download', id]); return new Promise((resolve) => { pending.download = () => resolve(current); }); },
    ttsLoad: async () => calls.push(['load']),
    ttsUnload: async () => calls.push(['unload']),
    deleteAudioClip: async () => {},
    deleteEntityAudioClips: async () => {},
    ttsPinClip: async () => {},
    ttsSpeak: async () => { throw new Error('not used'); },
    ttsCancel: async () => {},
  };
  const { ListenBalloon } = await loadBalloon();
  const host = document.getElementById('root');
  host.innerHTML = '';
  const props = { target: { kind: 'chat_message', id: 'msg-1', title: 'Respuesta', markdown: () => 'texto' }, anchor: { current: null }, onClose: () => calls.push(['close']) };
  let container;
  let tree;
  const render = async () => {
    container = document.createElement('div');
    host.appendChild(container);
    tree = createRoot(container);
    await act(async () => { tree.render(React.createElement(ListenBalloon, props)); });
    await act(async () => {});
    return container;
  };
  await render();
  return {
    calls,
    get container() { return container; },
    setStatus: (next) => { current = next; },
    emit: (event) => listeners.forEach((listener) => listener(event)),
    finish: pending,
    render,
    unmount: async () => { await act(async () => { tree.unmount(); }); },
  };
}

const byTestId = (container, id) => container.querySelector(`[data-testid="${id}"]`);
const progressbar = (container) => container.querySelector('[data-testid="listen-engine"] [role="progressbar"]');

test('an engine install reports its phase, its progress and a way out', async (t) => {
  const dom = setupDom();
  t.after(() => dom.window.close());
  const view = await mount(dom, status({ phononInstalled: false }));

  assert.equal(byTestId(view.container, 'listen-install')?.textContent.includes('El motor de voz no está instalado.'), true);
  assert.equal(byTestId(view.container, 'listen-install-phase'), null, 'no phase is invented before the click');
  await act(async () => { byTestId(view.container, 'listen-install-start').click(); });
  assert.deepEqual(view.calls.filter(([kind]) => kind === 'install'), [['install', 'phonon']], 'the click reaches the main process');

  // The main process emits this every phase; the balloon folds it into the same row.
  await act(async () => { view.emit({ kind: 'install', engine: 'phonon', phase: 'dependencies', fraction: 0.4 }); });
  const phase = byTestId(view.container, 'listen-install-phase');
  assert.ok(phase, 'the running install shows its phase');
  assert.match(phase.textContent, /Instalando dependencias/);
  assert.equal(progressbar(view.container)?.getAttribute('aria-valuenow'), '40');
  assert.ok(byTestId(view.container, 'listen-install-cancel'), 'a running install can be cancelled from the balloon');
  assert.equal(byTestId(view.container, 'listen-install-start'), null, 'the start button is not offered while it runs');

  await act(async () => { byTestId(view.container, 'listen-install-cancel').click(); });
  assert.deepEqual(view.calls.filter(([kind]) => kind === 'cancelInstall'), [['cancelInstall']]);
  await act(async () => { view.finish.install(); });
  await view.unmount();
});

test('a model download shows a bar from the click, before the first byte', async (t) => {
  const dom = setupDom();
  t.after(() => dom.window.close());
  const view = await mount(dom, status({ phononInstalled: true }));

  const download = byTestId(view.container, 'listen-model').querySelector('button[aria-label^="Descargar"]');
  assert.ok(download, 'the missing non-gated model offers its download');
  await act(async () => { download.click(); });
  assert.deepEqual(view.calls.filter(([kind]) => kind === 'download'), [['download', 'phonon-31m-en']]);

  // No model event yet: the row must not look unchanged.
  assert.match(byTestId(view.container, 'listen-model').textContent, /Descargando el modelo/);
  assert.equal(progressbar(view.container)?.getAttribute('aria-valuenow'), '0');

  await act(async () => { view.emit({ kind: 'model', status: { id: 'phonon-31m-en', downloaded: false, downloading: true, downloadedBytes: 32_500_000, totalBytes: 65_000_000, progress: 0.5 } }); });
  assert.equal(progressbar(view.container)?.getAttribute('aria-valuenow'), '50');

  // The finished transfer reaches the balloon as a status event, and the row goes away.
  const downloaded = status({ phononInstalled: true, modelDownloaded: true });
  await act(async () => {
    view.setStatus(downloaded);
    view.emit({ kind: 'status', status: downloaded });
    view.finish.download();
  });
  assert.equal(byTestId(view.container, 'listen-model'), null);
  await view.unmount();
});

test('the balloon asks for the engine status again every time it opens', async (t) => {
  const dom = setupDom();
  t.after(() => dom.window.close());
  const view = await mount(dom, status({ phononInstalled: false }));
  assert.equal(view.calls.filter(([kind]) => kind === 'status').length, 1);
  await view.unmount();
  // Same bundle, second opening: the shared cache alone would answer without asking the
  // main process, hiding an install that started in Settings while the balloon was closed.
  await view.render();
  assert.equal(view.calls.filter(([kind]) => kind === 'status').length, 2);
  await view.unmount();
});

test('a gated model sends the user to the model list, not to the voice library', async (t) => {
  const dom = setupDom();
  t.after(() => dom.window.close());
  const view = await mount(dom, status({ phononInstalled: true }), 'phonon-40m-es');
  const opened = [];
  window.addEventListener('nodus:open-narration-settings', (event) => opened.push(event.detail));
  const button = [...view.container.querySelectorAll('button')].find((entry) => entry.textContent === 'Abrir Ajustes');
  assert.ok(button, 'a gated model explains that it is downloaded from Settings');
  await act(async () => { button.click(); });
  assert.deepEqual(opened, ['models']);
  await view.unmount();
});

test('a failed install stops claiming to be running and keeps the reason', async (t) => {
  const dom = setupDom();
  t.after(() => dom.window.close());
  const view = await mount(dom, status({ phononInstalled: false }));

  await act(async () => { byTestId(view.container, 'listen-install-start').click(); });
  await act(async () => { view.emit({ kind: 'install', engine: 'phonon', phase: 'verifying', fraction: 0.92 }); });
  assert.match(byTestId(view.container, 'listen-install-phase').textContent, /Verificando el motor/);

  const failed = status({ phononInstalled: false, engineError: 'TTS_INSTALL_FAILED' });
  await act(async () => {
    view.setStatus(failed);
    view.emit({ kind: 'status', status: failed });
    view.finish.install(new Error('TTS_INSTALL_FAILED'));
  });

  assert.equal(byTestId(view.container, 'listen-install-phase'), null, 'the progress row is not left behind');
  assert.ok(byTestId(view.container, 'listen-install-start'), 'the install can be retried');
  const alerts = [...view.container.querySelectorAll('[role="alert"]')].map((entry) => entry.textContent);
  assert.ok(alerts.some((text) => /No se pudo instalar el motor de voz/.test(text)), 'the failure is explained');
  await view.unmount();
});

test('a failed install keeps its reason when the balloon is reopened', async (t) => {
  const dom = setupDom();
  t.after(() => dom.window.close());
  const view = await mount(dom, status({ phononInstalled: false, engineError: 'TTS_INSTALL_FAILED' }));
  const alert = byTestId(view.container, 'listen-install').querySelector('[role="alert"]');
  assert.ok(alert, 'the engine status error is rendered');
  assert.match(alert.textContent, /No se pudo instalar el motor de voz/);
  await view.unmount();
});
