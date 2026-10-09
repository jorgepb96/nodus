// A streaming answer is repainted a few times a second, not once per delta.
//
// Each delta arrives as its own IPC message and used to call setMessages on its own, so the
// timeline re-rendered and the growing answer's Markdown was re-parsed once per delta: work
// quadratic in the answer's length. Streaming the first 60,000 characters of a real answer
// from this library at 24 characters per delta cost 12.4 s of render time in jsdom.
//
// This mounts the real ResearchAssistantModal, delivers deltas one macrotask apart (as IPC
// does) and counts how often the streaming answer is rendered.
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
  stdin: { contents: "export { ResearchAssistantModal } from './src/views/ResearchAssistantModal'; export { ChatMarkdown } from './src/components/ChatMarkdown';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty', '.mp3': 'empty' },
  logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'chat-stream-paint-batching.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

test('deltas arriving faster than the paint interval are painted together', async () => {
  const { ResearchAssistantModal, ChatMarkdown } = await bundle;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  let streamingRenders = 0;
  let handlers = null;
  let finish = null;
  const adapter = {
    id: 'world', contextKey: 'k', canSend: true, subtitle: '', suggestions: [],
    listConversations: async () => [],
    getConversation: async () => null,
    createConversation: async () => ({ id: 'c1' }),
    saveConversationMessages: async () => undefined,
    deleteConversation: async () => undefined,
    researchChatStream: (_request, h) => { handlers = h; return new Promise(resolve => { finish = resolve; }); },
    cancelResearchChat: async () => undefined,
    renderMessage: (message, streaming) => {
      if (streaming) streamingRenders++;
      return React.createElement(ChatMarkdown, { content: message.content, streaming, verify: false });
    },
  };
  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  await act(async () => { rootNode.render(React.createElement(ResearchAssistantModal, { settings, embedded: true, adapter })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const textarea = container.querySelector('textarea');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setValue.call(textarea, 'A question'); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(handlers, 'the turn reached the stream');

  // Outside act, like the real IPC: each delta is its own macrotask and React renders between them.
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const before = streamingRenders;
  const DELTAS = 60;
  for (let index = 0; index < DELTAS; index++) {
    handlers.onDelta(`word${index} `);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }
  await new Promise(resolve => setTimeout(resolve, 120));
  const renders = streamingRenders - before;
  const shown = container.textContent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => { finish({ answer: Array.from({ length: DELTAS }, (_, index) => `word${index}`).join(' ') }); await new Promise(resolve => setTimeout(resolve, 20)); });
  const settled = container.textContent;
  await act(async () => { rootNode.unmount(); });

  assert.match(shown, new RegExp(`word0 word1 [\\s\\S]*word${DELTAS - 1}`), 'every delta reaches the screen');
  assert.ok(renders <= DELTAS / 4, `the streaming answer rendered ${renders} times for ${DELTAS} deltas`);
  assert.equal((settled.match(/word0 /g) ?? []).length, 1, 'the settled answer is not doubled by a late paint');
});
