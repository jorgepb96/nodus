import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// readSource resolves the '@main' / '@bridge' / '@api' sentinels to whole surfaces —
// the three former hot files are directories now — and any other path to that file.
const read = async (file) => readSource(file);

test('world chat has the same conversation, model, context and streaming controls as study chat', async () => {
  const [view, types, preload, ipc] = await Promise.all([
    read('src/views/WorldChatView.tsx'),
    read('@api'),
    read('@bridge'),
    read('@main'),
  ]);
  for (const contract of [
    'listWorldChatConversations',
    'getWorldChatConversation',
    'createWorldChatConversation',
    'saveWorldChatConversation',
    'deleteWorldChatConversation',
  ]) {
    for (const source of [view, types, preload, ipc]) assert.match(source, new RegExp(contract));
  }
  assert.match(view, /<ResearchAssistantModal settings=\{settings\} embedded adapter=\{adapter\}/);
  const shared = await read('src/views/ResearchAssistantModal.tsx');
  assert.match(shared, /research-history-sidebar/);
  assert.match(shared, /research-context-sidebar/);
  assert.match(shared, /useFeatureModel/);
  assert.match(shared, /<ConfirmModal/);
  assert.match(view, /selection\.scope === 'manual'/);
  assert.match(view, /entrySearch/);
  assert.match(view, /selection\.keepFocus/);
  assert.match(view, /cancelWorldChat/);
  assert.match(shared, /e\.key === 'Enter' && !phone && !e\.shiftKey/);
  assert.match(shared, /const phone = isPhoneSurface\(\)/);
  assert.match(shared, /<textarea/);
});

test('the global assistant action is mode-aware in worldbuilding', async () => {
  const app = await read('@shell');
  assert.match(app, /setView\(researchChatView\(activeVault\?\.type\)\)/);
  assert.match(app, /label: 'Research chat'/);
  const navigation = await read('src/navigation.ts');
  assert.match(navigation, /case 'worldbuilding': return 'worldChat'/);
});
