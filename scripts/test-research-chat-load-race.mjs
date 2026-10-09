// A streamed delta must re-render only the answer that is streaming.
//
// Study and World chats render their answers through `adapter.renderMessage`, which builds
// fresh callback props (onStudyEvidence, onWorldEntry) on every call. Those defeat the memo on
// ChatMarkdown and Markdown, so before the fix every delta re-ran react-markdown over every
// earlier answer in the conversation: the cost of one delta grew with the whole history.
//
// This mounts the real ResearchAssistantModal with a stub adapter, opens a stored
// conversation, streams a reply and counts how often each earlier answer is rendered.
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
  const module = new Module(path.join(root, 'scripts', 'research-chat-load-race.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const conversation = (id) => ({ id, title: `Chat ${id}`, selection: null, messages: [
  { id: `${id}-u`, role: 'user', content: `Question in ${id}`, selectionKey: 'k' },
  { id: `${id}-a`, role: 'assistant', content: `Answer from conversation ${id}`, selectionKey: 'k' },
] });

test('a slower earlier load does not replace the conversation opened after it', async () => {
  const { ResearchAssistantModal } = await bundle;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const pending = new Map();
  const adapter = {
    id: 'world', contextKey: 'k', canSend: true, subtitle: '', suggestions: [],
    listConversations: async () => [],
    getConversation: (id) => { const d = deferred(); pending.set(id, d); return d.promise; },
    createConversation: async () => ({ id: 'new' }),
    saveConversationMessages: async () => undefined,
    deleteConversation: async () => undefined,
    researchChatStream: async () => ({ answer: '' }),
    cancelResearchChat: async () => undefined,
    renderMessage: (message) => React.createElement('div', null, message.content),
  };
  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  const render = (target) => rootNode.render(React.createElement(ResearchAssistantModal, { settings, embedded: true, adapter, initialConversationTarget: target }));
  await act(async () => { render({ surface: 'world', conversationId: 'A', nonce: 1 }); });
  await act(async () => { render({ surface: 'world', conversationId: 'B', nonce: 2 }); });
  assert.ok(pending.has('A') && pending.has('B'), 'both loads started');
  await act(async () => { pending.get('B').resolve(conversation('B')); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.match(container.textContent, /Answer from conversation B/);
  await act(async () => { pending.get('A').resolve(conversation('A')); await new Promise(resolve => setTimeout(resolve, 10)); });
  const text = container.textContent;
  await act(async () => { rootNode.unmount(); });
  assert.match(text, /Answer from conversation B/, 'the chat opened last stays on screen');
  assert.doesNotMatch(text, /Answer from conversation A/, 'the earlier, slower load is dropped');
});
