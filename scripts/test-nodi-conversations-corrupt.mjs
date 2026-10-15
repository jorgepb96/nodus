// A corrupt Nodi chat history must not be silently replaced by the next save.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-nodi-history-'));
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('vaults/vaultRegistry')) return { getActiveVault: () => ({ id: 'v', name: 'V' }) };
  if (request.endsWith('/chatAssets')) return { chatAssetOwner: (kind, id) => `${kind}:${id}`, deleteChatAssets() {}, reconcileChatAssets() {} };
  return load.call(this, request, parent, isMain);
};
const conversations = require(path.join(root, 'electron/nodiConversations.ts'));

test('saving over a torn history file keeps the old conversations recoverable', () => {
  const file = path.join(userData, 'nodi-chat-history.json');
  const good = JSON.stringify({ version: 1, conversations: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `t${i}`, messages: [{ role: 'user', content: `hello ${i}` }], contexts: [], createdAt: 1, updatedAt: 1 })) });
  fs.writeFileSync(file, good.slice(0, -3));
  conversations.saveNodiConversation({ title: 'new', messages: [{ role: 'user', content: 'x' }] });
  const aside = fs.readdirSync(userData).filter((name) => name.startsWith('nodi-chat-history.json.corrupt-'));
  assert.equal(aside.length, 1, 'the corrupt file is kept beside the new one');
  assert.equal(fs.readFileSync(path.join(userData, aside[0]), 'utf8'), good.slice(0, -3));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).conversations.length, 1);
});
