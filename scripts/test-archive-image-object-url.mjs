// An archive image's object URL is never created for a detail that already closed.
//
// ArchiveItemDetail fetched the image bytes and created an object URL when they arrived; if
// the detail closed first, the cleanup had already run, so that URL (and the image bytes
// behind it) stayed alive for the rest of the session.
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const live = new Set();
let created = 0;
URL.createObjectURL = () => { const url = `blob:test/${++created}`; live.add(url); return url; };
URL.revokeObjectURL = (url) => { live.delete(url); };
let release = null;
dom.window.nodus = new Proxy({
  getArchiveItemBlob: () => new Promise(resolve => { release = () => resolve(new Uint8Array([137, 80, 78, 71]).buffer); }),
}, {
  get(target, key) { if (key in target) return target[key]; if (typeof key === 'string' && /^on[A-Z]/.test(key)) return () => () => {}; if (typeof key === 'string' && (key.startsWith('list') || key.startsWith('suggest'))) return async () => []; return async () => null; },
});

const bundle = build({
  stdin: { contents: "export { ArchiveItemDetail } from './src/views/ArchiveView';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.woff2': 'empty' }, logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'archive-image-object-url.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

const item = { itemId: 'i1', folderId: null, title: 'Parish record', kind: 'image', fileName: 'r.png', mimeType: 'image/png', bytes: 4, hasBlob: true,
  extractedText: null, description: null, source: null, contentHash: null, docType: null, metadata: null, year: null, linkedPersons: [], tags: [], folderIds: [] };

test('closing the detail before the image arrives leaves no object URL behind', async () => {
  const { ArchiveItemDetail } = await bundle;
  assert.equal(typeof ArchiveItemDetail, 'function');
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const rootNode = createRoot(document.getElementById('root'));
  await React.act(async () => { rootNode.render(React.createElement(ArchiveItemDetail, { item, isGenealogy: true, onClose: () => {}, onChanged: async () => {} })); });
  await React.act(async () => { rootNode.unmount(); });
  await React.act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(live.size, 0, `${live.size} object URL(s) outlived the closed detail`);
});

test('an open detail shows the image and releases it on close', async () => {
  const { ArchiveItemDetail } = await bundle;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await React.act(async () => { rootNode.render(React.createElement(ArchiveItemDetail, { item, isGenealogy: true, onClose: () => {}, onChanged: async () => {} })); });
  await React.act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.match(document.body.querySelector('img[alt="Parish record"]')?.getAttribute('src') ?? '', /^blob:test\//);
  await React.act(async () => { rootNode.unmount(); });
  assert.equal(live.size, 0);
});
