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
  const module = new Module(path.join(root, 'scripts', 'chat-adapter-stream-render.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

test('a streamed delta does not re-render the earlier answers of an adapter chat', async () => {
  const { ResearchAssistantModal, ChatMarkdown } = await bundle;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');

  const stored = Array.from({ length: 6 }, (_, index) => [
    { id: `u${index}`, role: 'user', content: `Question ${index}`, selectionKey: 'k' },
    { id: `a${index}`, role: 'assistant', content: `## Answer ${index}\n\nSome **markdown** with a [link](https://example.org) and a table:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`, selectionKey: 'k' },
  ]).flat();
  const renders = new Map();
  let handlers = null;
  let finish = null;
  const adapter = {
    id: 'world', contextKey: 'k', canSend: true, subtitle: '', suggestions: [],
    listConversations: async () => [{ id: 'c1', title: 'Stored', updatedAt: new Date().toISOString(), messageCount: stored.length }],
    getConversation: async () => ({ id: 'c1', title: 'Stored', selection: null, messages: stored }),
    createConversation: async () => ({ id: 'c1' }),
    saveConversationMessages: async () => undefined,
    deleteConversation: async () => undefined,
    researchChatStream: (_request, h) => { handlers = h; return new Promise(resolve => { finish = resolve; }); },
    cancelResearchChat: async () => undefined,
    // Like World and Study chat: a fresh callback prop on every call.
    renderMessage: (message, streaming) => {
      renders.set(message.id, (renders.get(message.id) ?? 0) + 1);
      return React.createElement(ChatMarkdown, { content: message.content, streaming, verify: false, onWorldEntry: kind => kind });
    },
  };

  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  await act(async () => {
    rootNode.render(React.createElement(ResearchAssistantModal, {
      settings, embedded: true, adapter,
      initialConversationTarget: { surface: 'world', conversationId: 'c1', nonce: 1 },
    }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.ok(container.textContent.includes('Answer 5'), 'the stored conversation is on screen');

  const textarea = container.querySelector('textarea');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setValue.call(textarea, 'Next question'); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(handlers, 'the turn reached the adapter stream');

  const before = renders.get('a0') ?? 0;
  const DELTAS = 40;
  for (let index = 0; index < DELTAS; index++) {
    await act(async () => { handlers.onDelta(`word${index} `); });
  }
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
  const during = (renders.get('a0') ?? 0) - before;
  assert.ok(container.textContent.includes(`word${DELTAS - 1}`), 'the streaming answer still shows every delta');
  await act(async () => { finish({ answer: 'done' }); await new Promise(resolve => setTimeout(resolve, 10)); });
  await act(async () => { rootNode.unmount(); });

  assert.ok(during <= 2, `an earlier answer re-rendered ${during} times during ${DELTAS} deltas`);
});
