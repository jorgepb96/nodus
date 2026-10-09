// A streamed delta must not rescan earlier answers for their web citations.
//
// Research Chat lists each answer's web sources under it and marks the ones the answer cites
// by searching the answer text for every passage id, several times per source inside a sort.
// The timeline re-renders on every streamed delta, so before the fix every earlier answer
// (often 100k+ characters) was rescanned per delta: 6.7 ms per timeline render for a real
// four-answer conversation of this library, before any Markdown work.
//
// This mounts the real ResearchAssistantModal on a stored conversation whose web sources count
// how often their passage ids are read, then streams a reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSS']) {
  try { Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true }); } catch { /* read-only global */ }
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.HTMLElement.prototype.scrollTo = function scrollTo() {};
dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
process.on('unhandledRejection', () => { /* stubbed bridge calls the view does not await */ });

const model = { provider: 'google', model: 'test-text-model' };
const settings = { chatModel: model, synthesisModel: model, favorites: [], researchWebSearch: 'off' };
const overrides = {
  getSettings: async () => settings,
  getResearchSystemPrompts: async () => ({ prompts: [], selectedId: null }),
  listResearchAttachments: async () => [],
  listCapabilities: async () => ({ providers: [] }),
  listConversations: async () => [],
  getConversation: async () => globalThis.__stored,
  getActiveVault: async () => ({ id: 'v1', type: 'academic', name: 'Vault' }),
  createConversation: async () => ({ id: 'c1' }),
  saveConversationMessages: async () => undefined,
  researchChatStream: (_request, handlers) => { globalThis.__handlers = handlers; return new Promise(resolve => { globalThis.__finish = resolve; }); },
  listResearchNotebooks: async () => [],
  verifyCitations: async () => ({}),
  listModels: async () => [],
};
dom.window.nodus = new Proxy(overrides, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string' && /^on[A-Z]/.test(key)) return () => () => {};
    if (typeof key === 'string' && key.startsWith('list')) return async () => [];
    return async () => null;
  },
});

const bundle = build({
  stdin: { contents: "export { ResearchAssistantModal } from './src/views/ResearchAssistantModal'; ", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty', '.mp3': 'empty' },
  logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'research-web-sources-render.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

let reads = 0;
function source(index) {
  const ids = [`web:p${index}a`, `web:p${index}b`];
  return { url: `https://example.org/${index}`, title: `Page ${index}`, domain: 'example.org', siteName: 'Example', get passageIds() { reads++; return ids; } };
}

test('streaming a reply does not rescan the earlier answers for web citations', async () => {
  const { ResearchAssistantModal } = await bundle;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const answer = (index) => `Answer ${index} cites [a page](nodus://passage/web%3Ap${index}a).\n\n` + 'Long body text. '.repeat(200);
  globalThis.__stored = { id: 'c1', title: 'Stored', selection: null, messages: [0, 1, 2].flatMap(index => [
    { id: `u${index}`, role: 'user', content: `Question ${index}`, selectionKey: null },
    { id: `a${index}`, role: 'assistant', content: answer(index), selectionKey: null,
      stats: { sections: [], works: 1, documents: 1, passages: 2, contextChars: 100, truncated: false, webSources: [source(index), source(index + 10)], webSearch: { searched: true, consulted: [], found: 2 } } },
  ]) };
  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  await act(async () => { rootNode.render(React.createElement(ResearchAssistantModal, { settings, initialConversationTarget: { surface: 'research', conversationId: 'c1', nonce: 1 } })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(container.querySelectorAll('[data-testid="research-web-sources"]').length, 3, 'each stored answer lists its web sources');
  assert.equal(container.querySelectorAll('.research-web-source-tag.cited').length, 3, 'the cited page of each answer is marked');

  const textarea = container.querySelector('textarea');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setValue.call(textarea, 'Next question'); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(globalThis.__handlers, 'the turn reached the stream');
  const before = reads;
  const DELTAS = 30;
  for (let index = 0; index < DELTAS; index++) await act(async () => { globalThis.__handlers.onDelta(`word${index} `); });
  const during = reads - before;
  await act(async () => { globalThis.__finish({ answer: 'done' }); await new Promise(resolve => setTimeout(resolve, 10)); });
  await act(async () => { rootNode.unmount(); });
  assert.equal(during, 0, `the earlier answers' web sources were rescanned (${during} passage-list reads over ${DELTAS} deltas)`);
});
