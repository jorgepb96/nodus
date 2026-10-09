// Paging quickly through the original-page preview must not end in an error.
//
// pdf.js refuses a second render() on a canvas that is still drawing ("Cannot use the same
// canvas during multiple render() operations"). The preview never cancelled the previous
// render, so clicking "next" twice in a row replaced the page with that error, and the canvas
// stayed gone until the preview was closed. The pdf.js stub below enforces the same rule.
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
globalThis.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.CSS = dom.window.CSS = { escape: value => String(value), supports: () => false };
dom.window.HTMLCanvasElement.prototype.getContext = function getContext() { return {}; };
dom.window.nodus = new Proxy({ getLibraryReaderAttachmentBytes: async () => new Uint8Array([37, 80, 68, 70]).buffer }, {
  get(target, key) { if (key in target) return target[key]; if (typeof key === 'string' && /^on[A-Z]/.test(key)) return () => () => {}; return async () => null; },
});

const busy = new WeakMap();
const rendered = [];
const pdfjs = {
  GlobalWorkerOptions: {}, TextLayer: class {},
  getDocument: () => ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 9, getPage: async (number) => ({
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    cleanup() {},
    render({ canvasContext: canvas }) {
      if (busy.has(canvas)) throw new Error('Cannot use the same canvas during multiple render() operations. Use different canvas or ensure previous operations were cancelled or completed.');
      const task = {};
      busy.set(canvas, task);
      let reject;
      const promise = new Promise((resolve, fail) => { reject = fail; setTimeout(() => { if (busy.get(canvas) === task) { busy.delete(canvas); rendered.push(number); resolve(); } }, 40); });
      return { promise, cancel() { if (busy.get(canvas) !== task) return; busy.delete(canvas); const error = new Error('Rendering cancelled'); error.name = 'RenderingCancelledException'; reject(error); } };
    },
  }) }) }),
};
// One context object per canvas, like the browser.
const contexts = new WeakMap();
dom.window.HTMLCanvasElement.prototype.getContext = function getContext() { if (!contexts.has(this)) contexts.set(this, {}); return contexts.get(this); };

const urlStub = { name: 'url-stub', setup(b) { b.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'url-stub' })); b.onLoad({ filter: /.*/, namespace: 'url-stub' }, () => ({ contents: 'export default ""', loader: 'js' })); } };
const bundle = build({
  stdin: { contents: "export { OriginalPagePreview } from './src/views/LibraryDocumentReader';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime', 'pdfjs-dist'], plugins: [urlStub],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' }, logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'library-original-preview.cjs'));
  module.paths = Module._nodeModulePaths(root);
  const original = module.require.bind(module);
  module.require = (id) => id === 'pdfjs-dist' ? pdfjs : original(id);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

test('clicking next several times in a row lands on the last page without an error', async () => {
  const { OriginalPagePreview } = await bundle;
  assert.equal(typeof OriginalPagePreview, 'function', 'the preview is importable');
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  await React.act(async () => {
    rootNode.render(React.createElement(OriginalPagePreview, { documentId: 'd1', attachmentId: 'a1', initialPage: 1, title: 'Original', onClose: () => {}, onOpenFull: () => {} }));
  });
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.ok(container.querySelector('canvas'), 'the first page is drawing');
  const next = container.querySelector('button[aria-label="Siguiente"], button[aria-label="Next"]');
  for (let click = 0; click < 3; click++) {
    await React.act(async () => { next.click(); await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
  const alert = container.querySelector('[role="alert"]')?.textContent ?? '';
  const canvas = container.querySelector('canvas');
  await React.act(async () => { rootNode.unmount(); });
  assert.equal(alert, '', 'no render error is shown');
  assert.equal(canvas?.dataset.page, '4');
  assert.equal(rendered.at(-1), 4, `the last page requested is the one drawn (drawn: ${rendered.join(',')})`);
});
