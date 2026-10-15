// Scrolling the reader must not re-render the saved answers of its document chat.
//
// The reader measured its progress on every scroll frame and stored the unrounded value, so
// the whole reader re-rendered at frame rate; the saved chat answers received fresh
// onCitation/onReaderCitation closures on every render, which defeated ChatMarkdown's memo
// and re-parsed every answer's Markdown per frame.
//
// This mounts the real LibraryDocumentReader with its chat open and counts how often the
// saved answers' ChatMarkdown renders while the document scrolls.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true }); } catch { /* read-only global */ }
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.CSS = dom.window.CSS = { escape: value => String(value), supports: () => false };
dom.window.innerWidth = 1600;
dom.window.HTMLElement.prototype.scrollTo = function scrollTo() {};
dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
process.on('unhandledRejection', () => {});

const sections = Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, title: `Section ${index}`, level: 2, page: index + 1 }));
const reader = {
  workId: 'w1', storageId: 'w1', zoteroKey: null, citationKey: null, title: 'A long book', authors: ['Author'], year: 2020, sourceUrl: null,
  markdown: sections.map(section => `## ${section.title}\n\n${'Body text. '.repeat(80)}`).join('\n\n'),
  cleanAvailable: true, sections, pageCount: 30, wordCount: 30000, originalAvailable: false, originalFileName: null, originalUrl: null, originalMimeType: null,
  attachments: [], sourceMapAvailable: false, contentFingerprint: null, extractionFingerprint: null, freshness: 'current', generatedAt: null, previousReadable: false,
};
const chat = Array.from({ length: 4 }, (_, index) => [
  { id: `q${index}`, role: 'user', content: `Question ${index}`, createdAt: '2026-01-01T00:00:00Z' },
  { id: `r${index}`, role: 'assistant', content: `Answer ${index} with a [reader link](nodus://reader/w1/section/s${index}) and **bold** text.`, createdAt: '2026-01-01T00:00:00Z' },
]).flat();
const model = { provider: 'google', model: 'test-text-model' };
dom.window.nodus = new Proxy({
  getLibraryReaderDocument: async () => reader,
  listLibraryReaderAnnotations: async () => [],
  listLibraryReaderOrphanedAnnotations: async () => [],
  listLibraryReaderChatMessages: async () => chat,
  getSettings: async () => ({ nodiModel: model, chatModel: model, synthesisModel: model, favorites: [] }),
  verifyCitations: async () => ({}),
}, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string' && /^on[A-Z]/.test(key)) return () => () => {};
    if (typeof key === 'string' && key.startsWith('list')) return async () => [];
    return async () => null;
  },
});

globalThis.__chatMarkdownRenders = 0;
const realChatMarkdown = path.join(root, 'src/components/ChatMarkdown.tsx');
const countingChatMarkdown = { name: 'counting-chat-markdown', setup(b) {
  b.onResolve({ filter: /components\/ChatMarkdown$/ }, args => args.importer.endsWith('LibraryDocumentReader.tsx') ? { path: 'counting', namespace: 'counting' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'counting' }, () => ({ loader: 'tsx', resolveDir: root, contents: `
    import { memo, createElement } from 'react';
    import { ChatMarkdown as Real } from ${JSON.stringify(realChatMarkdown)};
    // Same memo comparison as the real component: counts the renders it would really do.
    export const ChatMarkdown = memo(function Counting(props) { if (!props.streaming) globalThis.__chatMarkdownRenders++; return createElement(Real, props); });` }));
} };
const urlStub = { name: 'url-stub', setup(b) { b.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'url-stub' })); b.onLoad({ filter: /.*/, namespace: 'url-stub' }, () => ({ contents: 'export default ""', loader: 'js' })); } };
const bundle = build({
  stdin: { contents: "export { LibraryDocumentReader } from './src/views/LibraryDocumentReader';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime', 'pdfjs-dist'], plugins: [countingChatMarkdown, urlStub],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' }, logLevel: 'silent', jsx: 'automatic',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'library-reader-chat-render.cjs'));
  module.paths = Module._nodeModulePaths(root);
  const original = module.require.bind(module);
  module.require = (id) => id === 'pdfjs-dist' ? { GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(() => {}) }), TextLayer: class {} } : original(id);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

test('scrolling the reader does not re-render the saved chat answers', async () => {
  const { LibraryDocumentReader } = await bundle;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  const settle = (ms = 30) => React.act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  await React.act(async () => {
    rootNode.render(React.createElement(LibraryDocumentReader, { reference: { id: 'w1', title: 'A long book', preferredSource: 'clean' }, onBack: () => {}, onOpenAssistant: () => {}, initialSource: 'clean' }));
  });
  await settle();
  await React.act(async () => { container.querySelector('[data-testid="library-reader-open-chat"]').click(); });
  await settle();
  assert.ok(container.querySelector('[data-testid="library-reader-chat"]'), 'the document chat is open');
  assert.match(container.textContent, /Answer 3/, 'the saved answers are on screen');

  // A scroller with real geometry, scrolled one frame at a time.
  const scroller = [...container.querySelectorAll('*')].find(element => /overflow-(y-)?auto/.test(element.className) && element.querySelector('h2'));
  assert.ok(scroller, 'the reading surface is found');
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 20000 });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 800 });
  const before = globalThis.__chatMarkdownRenders;
  const FRAMES = 40;
  for (let frame = 1; frame <= FRAMES; frame++) {
    scroller.scrollTop = frame * 7;
    await React.act(async () => { scroller.dispatchEvent(new dom.window.Event('scroll')); await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  const renders = globalThis.__chatMarkdownRenders - before;
  await React.act(async () => { rootNode.unmount(); });
  assert.equal(renders, 0, `the saved answers re-rendered ${renders} times over ${FRAMES} scroll frames`);
});
