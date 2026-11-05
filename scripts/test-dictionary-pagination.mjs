import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-dictionary-pages-'));
installRuntimeHooks(directory);
const { readDictionaryCatalogue, readDictionaryEvidence } = createRequire(import.meta.url)('../shared/dictionaryPagination.ts');
test('reads all evidence and preserves filters beyond the first 500 receipts', async () => {
  const evidence=Array.from({length:1_203},(_,id)=>({id:`evidence-${id}`}));
  const result=await readDictionaryEvidence(async request=>{
    assert.equal(request.entryId,'concept');assert.equal(request.query,'source');assert.deepEqual(request.decisions,['included']);
    return {items:evidence.slice(request.offset,request.offset+73),total:evidence.length,offset:request.offset,limit:73};
  },{entryId:'concept',query:'source',decisions:['included']});
  assert.deepEqual(result.items,evidence);
});
test('reads every filtered entry beyond 500 even when the server caps pages', async () => {
  const entries = Array.from({ length: 1_203 }, (_, id) => ({ id: String(id) }));
  const offsets = [];
  const result = await readDictionaryCatalogue(async request => {
    assert.equal(request.query, 'concept'); offsets.push(request.offset);
    return { items: entries.slice(request.offset, request.offset + 73), total: entries.length, offset: request.offset, limit: 73 };
  }, { query: 'concept' });
  assert.deepEqual(result.items, entries); assert.equal(offsets.at(-1), 1_168);
});
test('restarts a catalogue which changed during pagination', async () => {
  let calls = 0;
  const result = await readDictionaryCatalogue(async ({ offset }) => {
    calls++;
    return { items: [{ id: String(offset) }], total: calls === 1 ? 3 : 2, offset, limit: 1 };
  }, {});
  assert.deepEqual(result.items.map(x => x.id), ['0', '1']); assert.equal(calls, 4);
});
test('a truncated transport response is an error instead of an empty dictionary', async () => {
  await assert.rejects(readDictionaryCatalogue(async ({ offset }) => ({ items: [], total: 1, offset, limit: 200 }), {}), /incomplete_dictionary_catalogue/);
  await assert.rejects(readDictionaryCatalogue(async () => ({ items: [], total: 0, offset: 200, limit: 200 }), {}), /invalid_dictionary_page/);
});
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
