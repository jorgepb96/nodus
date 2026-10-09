// An imported publication's HTML is rebuilt from an allowlist before the reader inserts it.
//
// The main process strips scripts from EPUB chapters, HTML snapshots and converted DOCX with
// regular expressions. This payload is what that regex pass returns for the crafted chapter
// `<ifr<iframe>ame srcdoc="…">`: a live srcdoc frame (same origin and CSP as the renderer,
// whose script-src admits data: URLs), plus unquoted handlers, a javascript: link, a meta
// refresh and an unquoted style overlay, all of which pass the regexes untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true }); } catch { /* read-only global */ }
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.CSS = dom.window.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch), highlights: undefined, supports: () => false };
process.on('unhandledRejection', () => {});

// Exactly what the main-process regex sanitizer returns for the crafted chapter (checked
// against electron/libraryReader/libraryReaderStore.ts sanitizedPublicationHtml).
const AFTER_MAIN_PROCESS = '<p>Chapter one text</p>'
  + '<iframe srcdoc="&lt;script src=&quot;data:text/javascript,parent.nodus.openExternal(1)&quot;&gt;&lt;/script&gt;"></iframe>'
  + '<img/src=x/onerror=alert(1)><a href=javascript:alert(1)>link</a><a href="#note-1">note</a>'
  + '<meta http-equiv="refresh" content="0;url=https://evil.example">'
  + '<p style=position:fixed;inset:0;z-index:99999>Session expired</p>'
  + '<p id="note-1">A <em>footnote</em> with <img src="data:image/png;base64,iVBORw0KGgo=" alt="figure"></p>';

let content = null;
dom.window.nodus = new Proxy({ getLibraryReaderAttachmentContent: async () => content }, {
  get(target, key) { if (key in target) return target[key]; if (typeof key === 'string' && /^on[A-Z]/.test(key)) return () => () => {}; return async () => null; },
});

const urlStub = { name: 'url-stub', setup(b) { b.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'url-stub' })); b.onLoad({ filter: /.*/, namespace: 'url-stub' }, () => ({ contents: 'export default ""', loader: 'js' })); } };
const bundle = build({
  stdin: { contents: "export { LibraryAttachmentViewer } from './src/components/library/LibraryAttachmentViewer';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime', 'pdfjs-dist'], plugins: [urlStub],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.woff2': 'empty' }, logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'library-attachment-html.cjs'));
  module.paths = Module._nodeModulePaths(root);
  const original = module.require.bind(module);
  module.require = (id) => id === 'pdfjs-dist' ? { GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(() => {}) }), TextLayer: class {} } : original(id);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

async function mount(viewer, payload) {
  const { LibraryAttachmentViewer } = await bundle;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  content = viewer === 'epub'
    ? { attachmentId: 'a1', viewer, text: 'Chapter one text', html: '', chapters: [{ id: 'c1', title: 'One', text: 'Chapter one text', html: payload }] }
    : { attachmentId: 'a1', viewer, text: 'Chapter one text', html: payload, chapters: [] };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await React.act(async () => {
    rootNode.render(React.createElement(LibraryAttachmentViewer, {
      documentId: 'd1', attachment: { id: 'a1', title: 'Book', viewer, available: true, url: '' }, annotations: [], highlighterColor: null,
      onCreate: async () => {}, onUpdateComment: async () => {}, onDelete: async () => {}, onError: () => {}, onOpenExternal: () => {},
    }));
  });
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const article = container.querySelector('article');
  return { article, unmount: () => React.act(async () => rootNode.unmount()) };
}

for (const viewer of ['html', 'epub']) {
  test(`a crafted ${viewer} attachment reaches the reader without active content`, async () => {
    const { article, unmount } = await mount(viewer, AFTER_MAIN_PROCESS);
    try {
      assert.ok(article, 'the publication is rendered as HTML');
      assert.equal(article.querySelectorAll('iframe, frame, object, embed, script, meta, link, base, style').length, 0, article.innerHTML);
      assert.equal(article.querySelectorAll('[srcdoc], [onerror], [style]').length, 0, article.innerHTML);
      assert.ok(![...article.querySelectorAll('a[href]')].some(link => /^\s*javascript:/i.test(link.getAttribute('href'))), article.innerHTML);
      assert.ok(![...article.querySelectorAll('img[src]')].some(image => image.getAttribute('src') === 'x'), article.innerHTML);
      // Ordinary publication markup is kept: text, emphasis, internal links, embedded figures.
      assert.match(article.textContent, /Chapter one text/);
      assert.match(article.textContent, /Session expired/);
      assert.equal(article.querySelector('a[href="#note-1"]')?.textContent, 'note');
      assert.ok(article.querySelector('p#note-1 em'));
      assert.equal(article.querySelector('img[alt="figure"]')?.getAttribute('src'), 'data:image/png;base64,iVBORw0KGgo=');
    } finally { await unmount(); }
  });
}
