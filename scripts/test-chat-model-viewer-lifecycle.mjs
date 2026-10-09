// A 3D model viewer never outlives the model it was opened for.
//
// 1. ChatModelViewer: closing the model (or leaving the message) while it is still loading
//    ran teardown before the viewer existed; the build then resolved into the ref and kept a
//    WebGL context and a requestAnimationFrame loop alive off screen. Reopening returned
//    early because the ref was set, so the model never showed again.
// 2. buildModelViewer: the renderer, its canvas and the orbit controls were created before
//    the asset was parsed; a parse failure left all of them behind on every attempt.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true }); } catch { /* read-only global */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const counters = { builds: [], rendererDisposed: 0, controlsDisposed: 0 };
globalThis.__viewerTest = counters;
dom.window.nodus = { readCapabilityModel: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'model/gltf-binary' }) };

function load(entry, plugins) {
  return build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react', 'react-dom', 'react/jsx-runtime'], plugins, loader: { '.css': 'empty' }, logLevel: 'silent' })
    .then(result => {
      const module = new Module(path.join(root, 'scripts', `model-viewer-${Math.random()}.cjs`));
      module.paths = Module._nodeModulePaths(root);
      module._compile(result.outputFiles[0].text, module.id);
      return module.exports;
    });
}

// The viewer component, with its lazily imported builder replaced by one the test resolves by hand.
const builderStub = { name: 'builder-stub', setup(b) {
  b.onResolve({ filter: /lib\/modelViewer$/ }, () => ({ path: 'builder', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `
    export default function build() {
      const handle = { disposed: 0, dispose() { this.disposed++; }, reset() {}, fit() {} };
      return new Promise(resolve => globalThis.__viewerTest.builds.push({ handle, resolve: () => resolve(handle) }));
    }` }));
} };

// three.js replaced by just enough to count what the builder creates and disposes.
const threeStub = { name: 'three-stub', setup(b) {
  b.onResolve({ filter: /^three(\/.*)?$/ }, args => ({ path: args.path, namespace: 'three' }));
  b.onLoad({ filter: /.*/, namespace: 'three' }, () => ({ loader: 'js', contents: `
    const t = globalThis.__viewerTest;
    class Thing { constructor() { this.position = { set() {}, copy() {} }; } add() {} traverse() {} }
    export class Scene extends Thing {} export class Group extends Thing {} export class AmbientLight extends Thing {}
    export class DirectionalLight extends Thing {} export class PerspectiveCamera extends Thing { updateProjectionMatrix() {} }
    export class Color {} export class Box3 {} export class Sphere {} export class Vector3 {} export const MathUtils = {};
    export const ACESFilmicToneMapping = 0, SRGBColorSpace = '';
    export class WebGLRenderer { constructor() { this.domElement = document.createElement('canvas'); } setPixelRatio() {} setClearColor() {} setSize() {} render() {} dispose() { t.rendererDisposed++; } }
    export class GLTFLoader { parse(_payload, _path, _ok, fail) { fail(new Error('not a model')); } }
    export class OrbitControls { constructor() { this.target = {}; } dispose() { t.controlsDisposed++; } update() {} }` }));
} };

const viewer = load("export { ChatModelViewer } from './src/components/ChatModelViewer'; export { setActiveLang } from './src/i18n';", [builderStub]);
const builder = load("export { default } from './src/lib/modelViewer';", [threeStub]);

test('closing a model while it loads disposes the viewer that arrives afterwards, and reopening shows it', async () => {
  const { ChatModelViewer } = await viewer;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  const node = { kind: 'model', attachmentId: 'm1', title: 'Model', name: 'm.glb', alt: 'A model', bytes: 3 };
  const button = (label) => [...container.querySelectorAll('button')].find(item => item.textContent.includes(label));
  const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });

  await React.act(async () => { rootNode.render(React.createElement(ChatModelViewer, { node, owner: 'chat-1' })); });
  await React.act(async () => { button('3D').click(); });
  await settle();
  assert.equal(counters.builds.length, 1, 'opening starts one build');
  await React.act(async () => { button('Cerrar').click(); });
  await React.act(async () => { counters.builds[0].resolve(); });
  await settle();
  assert.equal(counters.builds[0].handle.disposed, 1, 'the viewer built after closing is disposed at once');

  await React.act(async () => { button('3D').click(); });
  await settle();
  assert.equal(counters.builds.length, 2, 'reopening builds the model again');
  await React.act(async () => { counters.builds[1].resolve(); });
  await settle();
  assert.equal(container.querySelector('figure').dataset.state, 'ready');
  assert.equal(counters.builds[1].handle.disposed, 0);
  await React.act(async () => { rootNode.unmount(); });
  assert.equal(counters.builds[1].handle.disposed, 1, 'unmounting disposes the live viewer');
});

test('a model that fails to parse leaves no renderer, canvas or controls behind', async () => {
  const { default: buildModelViewer } = await builder;
  const container = document.createElement('div');
  document.body.appendChild(container);
  await assert.rejects(buildModelViewer({ container, bytes: new Uint8Array([1]), mimeType: 'model/gltf-binary', maxPixelRatio: 2, label: 'x' }), /not a model/);
  assert.equal(counters.rendererDisposed, 1, 'the renderer is disposed');
  assert.equal(counters.controlsDisposed, 1, 'the controls are disposed');
  assert.equal(container.querySelector('canvas'), null, 'the canvas is removed');
});
