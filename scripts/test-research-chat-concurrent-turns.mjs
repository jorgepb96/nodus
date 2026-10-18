// A chat that is answering does not lock the others.
//
// Research Chat used to hold one `sending` flag for the whole view: while any answer streamed,
// the history would not open another chat, "new chat" was disabled, and a view mounted later
// locked its composer for a turn running in some other conversation. Turns are now kept per
// conversation: only the chat on screen locks while its own turn runs, Stop reaches that chat
// alone, and a chat reopened mid-answer picks the answer up where it is.
//
// This mounts the real ResearchAssistantModal with a stub transport whose streams stay open
// until the test settles them, so two chats can answer at the same time.
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
  stdin: { contents: "export { ResearchAssistantModal } from './src/views/ResearchAssistantModal';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty', '.mp3': 'empty' },
  logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'research-chat-concurrent-turns.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Longer than the view's stream paint interval. */
const PAINT = 90;

/** A chat store and a transport whose answers stream only when the test says so. */
function stubSurface(React) {
  const chats = new Map();
  const streams = new Map();
  const cancelled = [];
  let created = 0;
  const adapter = {
    id: 'world', contextKey: 'k', canSend: true, subtitle: '', suggestions: [],
    listConversations: async () => [...chats.values()].map(chat => ({ id: chat.id, title: chat.title, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', messageCount: chat.messages.length })),
    getConversation: async id => chats.has(id) ? { id, title: chats.get(id).title, selection: null, messages: chats.get(id).messages.map(message => ({ ...message })) } : null,
    createConversation: async input => { const id = `chat-${++created}`; chats.set(id, { id, title: input.title ?? id, messages: [] }); return { id }; },
    saveConversationMessages: async (id, messages) => { chats.get(id).messages = messages.map(message => ({ ...message })); },
    deleteConversation: async id => { chats.delete(id); },
    researchChatStream: (request, handlers) => new Promise(resolve => { streams.set(request.conversationId, { handlers, resolve, partial: '' }); }),
    cancelResearchChat: async id => {
      cancelled.push(id);
      const stream = streams.get(id);
      if (stream) { streams.delete(id); stream.resolve({ answer: stream.partial, aborted: true }); }
    },
    renderMessage: message => React.createElement('div', null, message.content),
  };
  return {
    adapter, chats, streams, cancelled,
    deliver(id, text) { const stream = streams.get(id); stream.partial += text; stream.handlers.onDelta(text); },
    answer(id, text) { const stream = streams.get(id); streams.delete(id); stream.resolve({ answer: text }); },
  };
}

function screen(container) {
  return {
    messages: () => [...container.querySelectorAll('[data-message-id]')].map(node => node.textContent).join('\n'),
    stop: () => container.querySelector('button[aria-label="Detener generación"]'),
    send: () => container.querySelector('button[aria-label="Enviar"]'),
    newChat: () => container.querySelector('[data-testid="research-new-conversation"]'),
    running: id => container.querySelector(`[data-testid="research-conversation-running-${id}"]`),
    openChat: id => container.querySelector(`[data-testid="research-conversation-${id}"] .research-history-main`),
  };
}

async function type(act, container, text) {
  const textarea = container.querySelector('textarea');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setValue.call(textarea, text); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(20); });
}

test('another chat opens, starts and answers while one is still answering', async () => {
  const { ResearchAssistantModal } = await bundle;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const surface = stubSurface(React);
  const container = document.getElementById('root');
  const rootNode = createRoot(container);
  const view = screen(container);
  await act(async () => { rootNode.render(React.createElement(ResearchAssistantModal, { settings, embedded: true, adapter: surface.adapter })); await sleep(20); });

  // Chat 1 starts answering.
  await type(act, container, 'Question one');
  assert.ok(surface.streams.has('chat-1'), 'the first chat is answering');
  await act(async () => { surface.deliver('chat-1', 'Partial one'); await sleep(PAINT); });
  assert.match(view.messages(), /Partial one/);
  assert.ok(view.stop(), 'the chat that answers offers Stop');
  assert.ok(view.running('chat-1'), 'the history marks the chat that answers');

  // A new chat opens meanwhile, unlocked, and answers too.
  assert.equal(view.newChat().disabled, false, 'New chat stays available while a chat answers');
  await act(async () => { view.newChat().click(); await sleep(20); });
  assert.doesNotMatch(view.messages(), /Question one|Partial one/, 'the new chat is empty');
  assert.ok(view.send() && !view.stop(), 'the new chat composer is not locked by the other chat');
  await type(act, container, 'Question two');
  assert.ok(surface.streams.has('chat-1') && surface.streams.has('chat-2'), 'both chats answer at once');

  // Chat 1 keeps streaming off screen; it never paints into chat 2.
  await act(async () => { surface.deliver('chat-1', ' grows'); surface.deliver('chat-2', 'Partial two'); await sleep(PAINT); });
  assert.match(view.messages(), /Question two[\s\S]*Partial two/);
  assert.doesNotMatch(view.messages(), /Partial one|grows/, 'the other chat never paints here');

  // Reopening chat 1 from the history shows its answer where it is, and it keeps streaming.
  await act(async () => { view.openChat('chat-1').click(); await sleep(PAINT); });
  assert.match(view.messages(), /Question one[\s\S]*Partial one grows/, 'the reopened chat shows its answer so far');
  assert.doesNotMatch(view.messages(), /Partial two/);
  assert.ok(view.stop(), 'the reopened chat is still answering');
  await act(async () => { surface.deliver('chat-1', ' further'); await sleep(PAINT); });
  assert.equal((view.messages().match(/Partial one grows further/g) ?? []).length, 1, 'the reopened chat keeps streaming, once');

  // Stop reaches the chat on screen only.
  await act(async () => { view.stop().click(); await sleep(PAINT); });
  assert.deepEqual(surface.cancelled, ['chat-1'], 'Stop cancels only the chat on screen');
  assert.ok(surface.streams.has('chat-2'), 'the other chat keeps answering');
  const stopped = surface.chats.get('chat-1').messages.at(-1);
  assert.equal(stopped.content, 'Partial one grows further');
  assert.equal(stopped.interrupted, true, 'the stopped answer is kept as interrupted');
  assert.ok(view.send() && !view.stop(), 'the stopped chat unlocks');
  assert.equal(view.running('chat-1'), null);
  assert.ok(view.running('chat-2'), 'the history still marks the chat answering');

  // Chat 2 finishes off screen: saved in its own chat, not painted here.
  await act(async () => { surface.answer('chat-2', 'Final two'); await sleep(PAINT); });
  assert.equal(surface.chats.get('chat-2').messages.at(-1).content, 'Final two');
  assert.doesNotMatch(view.messages(), /Final two/);
  assert.equal(view.running('chat-2'), null);
  await act(async () => { view.openChat('chat-2').click(); await sleep(PAINT); });
  assert.match(view.messages(), /Question two[\s\S]*Final two/);
  await act(async () => { rootNode.unmount(); });
});

test('a view mounted while a chat answers locks only that chat', async () => {
  const { ResearchAssistantModal } = await bundle;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const surface = stubSurface(React);
  const container = document.getElementById('root');
  let rootNode = createRoot(container);
  const view = screen(container);
  await act(async () => { rootNode.render(React.createElement(ResearchAssistantModal, { settings, embedded: true, adapter: surface.adapter })); await sleep(20); });
  await type(act, container, 'Question one');
  await act(async () => { surface.deliver('chat-1', 'Partial one'); await sleep(PAINT); });

  // The user leaves the chat section and comes back: a new view, the turn still running.
  await act(async () => { rootNode.unmount(); });
  rootNode = createRoot(container);
  await act(async () => { rootNode.render(React.createElement(ResearchAssistantModal, { settings, embedded: true, adapter: surface.adapter })); await sleep(20); });
  assert.ok(view.send() && !view.stop(), 'a new chat is not locked by a turn in another chat');
  assert.equal(view.newChat().disabled, false);
  assert.ok(view.running('chat-1'), 'the history marks the chat still answering');

  await act(async () => { view.openChat('chat-1').click(); await sleep(PAINT); });
  assert.match(view.messages(), /Question one[\s\S]*Partial one/);
  assert.ok(view.stop(), 'the chat still answering offers Stop');
  await act(async () => { surface.deliver('chat-1', ' grows'); await sleep(PAINT); });
  assert.match(view.messages(), /Partial one grows/, 'the turn sent by the old view is followed live');
  await act(async () => { surface.answer('chat-1', 'Final one'); await sleep(PAINT); });
  assert.match(view.messages(), /Final one/, 'the settled answer replaces the streamed one');
  assert.ok(view.send() && !view.stop(), 'the chat unlocks when its turn ends');
  await act(async () => { rootNode.unmount(); });
});
