import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('Nodi and the research assistant share the Zotero-style waiting indicator', async () => {
  const [indicator, styles, nodi, assistant] = await Promise.all([
    read('src/components/ChatTypingIndicator.tsx'),
    read('src/components/chatTypingIndicator.css'),
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/views/ResearchAssistantModal.tsx'),
  ]);

  assert.equal((indicator.match(/className="chat-typing-dot"/g) ?? []).length, 3);
  assert.match(styles, /animation: chat-typing-dot 1\.2s infinite ease-in-out/);
  assert.match(styles, /transform: translateY\(-4px\)/);
  assert.match(styles, /\.chat-typing-dot:nth-child\(2\)/);
  assert.match(styles, /\.chat-typing-dot:nth-child\(3\)/);

  assert.match(nodi, /streaming && i === messages\.length - 1 \? <ChatTypingIndicator/);
  assert.match(assistant, /message\.id === streamingId \? \(\s*<ChatTypingIndicator/);
  assert.doesNotMatch(nodi, /escribiendo…<\/span>/);
});

test('the research assistant holds the start of a streaming answer like Nodi', async () => {
  const assistant = await read('src/views/ResearchAssistantModal.tsx');
  const generate = assistant.slice(
    assistant.indexOf('const generate = async'),
    assistant.indexOf('const send = async'),
  );

  assert.equal(
    (generate.match(/scrollToBottom\('auto'\)/g) ?? []).length,
    1,
    'a new turn scrolls into view once, before streaming begins',
  );
  // The turn is marked as streaming (its chat's live turn starts) before it scrolls into view.
  assert.match(generate, /liveResearchTurns\.start\(\{[^}]*assistantId[\s\S]*?setTimeout\(\(\) => scrollToBottom\('auto'\), 0\)[\s\S]*?researchChatStream/);
  assert.doesNotMatch(generate, /onDelta:[\s\S]*?scrollToBottom/, 'stream deltas never chase the bottom');
  assert.doesNotMatch(assistant, /stickToBottomRef/, 'there is no latent stream-following mode');
  assert.match(generate, /onDelta:[\s\S]*?setTimeout\(updateJumpIndicator, 0\)/, 'growth still exposes the manual jump-to-bottom control');
});
