import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chat-queue-'));
const output = path.join(dir, 'queue.cjs');
buildSync({ entryPoints: ['src/researchChatQueue.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const require = createRequire(import.meta.url);
const stored = new Map();
globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
const load = () => { delete require.cache[require.resolve(output)]; return require(output).researchChatQueue; };
const item = content => ({ id: content, content, attachments: [], skills: [], settings: { model: { provider: 'openai', model: 'fixture' }, selection: { layers: { indexed: true } }, explorationMode: 'fast', thinkingEffort: 'high', systemPromptSnapshot: { id: 'p', name: 'Original', instructions: 'Original instructions' }, concilium: { chairman: 0, models: [{ provider: 'openai', model: 'fixture' }, { provider: 'gemini', model: 'fixture-2' }] }, webSearch: 'off', answerVerification: 'structured' } });

test('queued requests copy all settings; editing keeps position, attachments and configuration', () => {
  const queue = load();
  const original = item('one'); queue.add('v:chat', original); queue.add('v:chat', item('two'));
  original.settings.model.model = 'changed'; original.settings.concilium.models[0].model = 'changed';
  original.settings.systemPromptSnapshot.instructions = 'Changed';
  queue.edit('v:chat', 'one'); queue.save('v:chat', 'one', 'edited');
  const [first, second] = queue.get('v:chat').items;
  assert.equal(first.content, 'edited'); assert.equal(second.id, 'two');
  assert.equal(first.settings.model.model, 'fixture');
  assert.equal(first.settings.concilium.models[0].model, 'fixture');
  assert.equal(first.settings.systemPromptSnapshot.instructions, 'Original instructions');
});

test('one worker drains FIFO, including new arrivals, and waits while editing or confirming deletion', async () => {
  const queue = load(), calls = [];
  queue.add('fifo', item('a')); queue.add('fifo', item('b'));
  let release;
  const worker = queue.run('fifo', async request => { calls.push(request.content); if (request.id === 'a') await new Promise(resolve => { release = resolve; }); return 'completed'; });
  await queue.run('fifo', async () => { throw new Error('Concurrent worker'); });
  queue.add('fifo', item('c')); queue.edit('fifo', 'b'); release(); await worker;
  assert.deepEqual(calls, ['a']);
  queue.save('fifo', 'b', 'b edited'); queue.change('fifo', { deletingId: 'c' });
  await queue.run('fifo', async () => { throw new Error('Deletion dialog must hold the queue'); });
  queue.remove('fifo', 'c');
  await queue.run('fifo', async request => { calls.push(request.content); return 'completed'; });
  assert.deepEqual(calls, ['a', 'b edited']); assert.equal(queue.get('fifo').items.length, 0);
});

test('stop/failure pauses remaining requests; preflight errors keep the unsubmitted request', async () => {
  for (const result of ['cancelled', 'failed']) {
    const queue = load(), key = `stop-${result}`;
    queue.add(key, item('a')); queue.add(key, item('b'));
    await queue.run(key, async () => result);
    assert.equal(queue.get(key).paused, true); assert.equal(queue.get(key).items[0].id, 'b');
  }
  const queue = load(); queue.add('preflight', item('a'));
  await queue.run('preflight', async () => { throw new Error('Wrong vault'); });
  assert.equal(queue.get('preflight').items[0].id, 'a'); assert.equal(queue.get('preflight').error, 'Wrong vault');
});

test('reload restores pending requests paused and isolates vaults and conversations', () => {
  let queue = load(); queue.add('vault-one:chat', item('first')); queue.add('vault-two:chat', item('other'));
  queue = load();
  assert.equal(queue.get('vault-one:chat').paused, true);
  assert.equal(queue.get('vault-one:chat').items[0].content, 'first');
  assert.equal(queue.get('vault-two:chat').items[0].content, 'other');
  queue.clear('vault-one:chat'); assert.equal(queue.get('vault-two:chat').items.length, 1);
});

test('drag reordering preserves snapshots and holds processing until the drop', async () => {
  const queue = load();
  for (const name of ['a', 'b', 'c']) queue.add('drag', item(name));
  const snapshot = structuredClone(queue.get('drag').items[0]);
  queue.change('drag', { draggingId: 'a' });
  await queue.run('drag', async () => { throw new Error('Must wait for drop'); });
  queue.move('drag', 'a', 'c');
  assert.deepEqual(queue.get('drag').items.map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(queue.get('drag').items[2], snapshot);
  assert.equal(queue.get('drag').draggingId, null);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
