// Typing into a page and leaving it within the save debounce must still save what was typed.
//
// PageBlockEditor saves 550 ms after the last edit. Its unmount cleanup cancelled that timer,
// so closing a database row's page (or a wiki page) right after typing silently dropped the
// last edits. DatabasesView renders the editor without a key, so switching rows did the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'Node', 'Event', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true }); } catch { /* read-only global */ }
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const pageDocument = (id) => ({ page: { id, title: 'Page', locked: false }, blocks: [{ id: 'b1', parentBlockId: null, order: 0, type: 'paragraph', content: { text: 'Before' } }],
  yjsState: new Uint8Array(), stateVector: new Uint8Array(), revision: 3, updateSequence: 0, snapshotSequence: 0, markdown: 'Before' });
const saves = [];
dom.window.nodus = new Proxy({
  getPageForDatabaseRow: async (rowId) => pageDocument(`page-of-${rowId}`),
  savePageDocument: async (request) => { saves.push(request); return { ok: true, document: { ...pageDocument(request.pageId), revision: request.expectedRevision + 1 } }; },
}, {
  get(target, key) { if (key in target) return target[key]; if (typeof key === 'string' && /^on[A-Z]/.test(key)) return () => () => {}; if (typeof key === 'string' && key.startsWith('list')) return async () => []; return async () => null; },
});

const bundle = build({
  stdin: { contents: "export { PageBlockEditor } from './src/components/pages/PageBlockEditor';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty' }, logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'page-block-editor-flush.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

async function typeThen(leave) {
  const { PageBlockEditor } = await bundle;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  saves.length = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await React.act(async () => { rootNode.render(React.createElement(PageBlockEditor, { rowId: 'row-1' })); });
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const textarea = [...container.querySelectorAll('textarea')].find(field => field.value === 'Before');
  assert.ok(textarea, 'the block is editable');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await React.act(async () => { setValue.call(textarea, 'Before and after'); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await leave(React, rootNode);
  await new Promise(resolve => setTimeout(resolve, 700));
  await React.act(async () => { rootNode.unmount(); });
}

test('closing the page inside the save debounce still saves the last edit', async () => {
  await typeThen(async (React, rootNode) => { await React.act(async () => { rootNode.unmount(); }); });
  assert.equal(saves.length, 1, 'the pending edit is written once');
  assert.equal(saves[0].pageId, 'page-of-row-1');
  assert.equal(saves[0].expectedRevision, 3);
  assert.equal(saves[0].blocks[0].content.text, 'Before and after');
});

test('switching to another row inside the debounce saves the edit to the row it was typed in', async () => {
  const { PageBlockEditor } = await bundle;
  await typeThen(async (React, rootNode) => { await React.act(async () => { rootNode.render(React.createElement(PageBlockEditor, { rowId: 'row-2' })); }); });
  const typed = saves.filter(save => save.blocks[0]?.content?.text === 'Before and after');
  assert.equal(typed.length, 1, 'the edit is saved once');
  assert.equal(typed[0].pageId, 'page-of-row-1', 'against the page it was typed into');
  assert.ok(!saves.some(save => save.pageId === 'page-of-row-2'), 'the next row is not written');
});

test('an edit left alone is saved once by the debounce, not again on close', async () => {
  await typeThen(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].blocks[0].content.text, 'Before and after');
});
