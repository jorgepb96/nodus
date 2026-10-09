// Closing a recorder while the microphone permission is pending must not leave it recording.
//
// LocalAudioRecorder (class and interview recordings) and StudyDictation await the privacy
// notice and getUserMedia before they keep the stream. Their unmount cleanup ran before the
// stream existed, so a view closed during that wait opened the microphone afterwards, with a
// MediaRecorder, an AudioContext, a timer and a level-meter loop that nothing stopped: the
// system's microphone indicator stayed on.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true }); } catch { /* read-only global */ }
}
globalThis.localStorage = dom.window.localStorage;
localStorage.setItem('nodus.micPrivacyAcknowledged', '1');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
// The dictation lists its saved clips from IndexedDB, which jsdom does not provide; the stub never answers.
globalThis.indexedDB = dom.window.indexedDB = { open() { return {}; } };
process.on('unhandledRejection', () => {});

const live = { tracks: 0, recorders: 0, contexts: 0 };
let grant = null;
const mediaDevices = {
  getUserMedia: () => new Promise(resolve => { grant = () => { live.tracks++; resolve({ getTracks: () => [{ stop() { live.tracks--; } }] }); }; }),
  enumerateDevices: async () => [],
};
Object.defineProperty(dom.window.navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
globalThis.MediaRecorder = dom.window.MediaRecorder = class { constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; } static isTypeSupported() { return true; } start() { this.state = 'recording'; live.recorders++; } stop() { if (this.state !== 'inactive') live.recorders--; this.state = 'inactive'; } pause() {} resume() {} };
globalThis.AudioContext = dom.window.AudioContext = class { constructor() { live.contexts++; } createAnalyser() { return { fftSize: 0, getByteTimeDomainData() {} }; } createMediaStreamSource() { return { connect() {} }; } async close() { live.contexts--; } };
dom.window.nodus = new Proxy({ getSettings: async () => ({ sttProvider: 'transformers', sttTransformersModel: 'none' }) }, {
  get(target, key) { if (key in target) return target[key]; if (typeof key === 'string' && /^on[A-Z]/.test(key)) return () => () => {}; if (typeof key === 'string' && key.startsWith('list')) return async () => []; return async () => null; },
});

const bundle = build({
  stdin: { contents: "export { useLocalAudioRecorder } from './src/components/media/LocalAudioRecorder'; export { StudyDictation } from './src/components/editor/StudyDictation';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime', '@huggingface/transformers', 'onnxruntime-web'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty' }, logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'microphone-start-after-close.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

const settle = (React) => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });

test('a class or interview recorder closed while the permission is pending releases the microphone', async () => {
  const { useLocalAudioRecorder } = await bundle;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  let handle = null;
  function Host() { handle = useLocalAudioRecorder({ fileBaseName: 'clase', onError: () => {}, onSaved: () => {} }); return null; }
  const rootNode = createRoot(document.createElement('div'));
  await React.act(async () => { rootNode.render(React.createElement(Host)); });
  await React.act(async () => { void handle.start(); });
  await settle(React);
  assert.ok(grant, 'the microphone was requested');
  await React.act(async () => { rootNode.unmount(); });
  await React.act(async () => { grant(); });
  await settle(React);
  assert.deepEqual({ ...live }, { tracks: 0, recorders: 0, contexts: 0 }, 'nothing keeps the microphone open');
});

test('a dictation closed while the permission is pending releases the microphone', async () => {
  const { StudyDictation } = await bundle;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  grant = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await React.act(async () => { rootNode.render(React.createElement(StudyDictation, { documentId: 'd1', language: 'en', vocabulary: [], customDictionary: [], onInsert: () => {}, onAction: () => {} })); });
  await settle(React);
  await React.act(async () => { container.querySelector('[data-testid="study-dictation-start"]').click(); });
  await settle(React);
  assert.ok(grant, 'the microphone was requested');
  await React.act(async () => { rootNode.unmount(); });
  await React.act(async () => { grant(); });
  await settle(React);
  assert.deepEqual({ ...live }, { tracks: 0, recorders: 0, contexts: 0 }, 'nothing keeps the microphone open');
});
