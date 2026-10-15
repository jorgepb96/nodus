import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-eg2-contracts-'));
async function load(entry) {
  const file = path.join(directory, path.basename(entry) + '.mjs');
  await build({ entryPoints: [entry], outfile: file, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(pathToFileURL(file));
}
const gemma = await load('shared/embeddingGemma2.ts');
const contracts = await load('shared/embeddingContract.ts');
const models = await load('shared/localAiModels.ts');
const strict = await load('electron/ai/strictEmbeddings.ts');
const language = await load('shared/uiLanguage.ts');
test.after(() => fs.rm(directory, { recursive: true, force: true }));

test('immutable profiles pin weights, tokenizer, tasks, projection and normalization', async () => {
  const a = gemma.embeddingGemma2Contract('embeddinggemma-2-text-q8-512-v1');
  const b = gemma.embeddingGemma2Contract('embeddinggemma-2-text-q8-256-v1');
  assert.equal(a.preprocessing.weights, gemma.EMBEDDING_GEMMA2_REVISION);
  assert.equal(a.preprocessing.tokenizer, a.preprocessing.weights);
  assert.notEqual(await contracts.fingerprintEmbeddingContract(a), await contracts.fingerprintEmbeddingContract(b));
  const wrong = { ...a, task: { ...a.task, query: 'different prompt' } };
  assert.notEqual(await contracts.fingerprintEmbeddingContract(a), await contracts.fingerprintEmbeddingContract(wrong));
  assert.throws(() => gemma.embeddingGemma2Contract('embeddinggemma-2-text-q4-512-v1'));
  assert(Object.isFrozen(a.preprocessing));
});
test('query/document prompts and titles do not silently strip content', () => {
  assert.equal(gemma.prepareEmbeddingGemma2Input('¿Por qué?', 'query'), 'task: search result | query: ¿Por qué?');
  assert.equal(gemma.prepareEmbeddingGemma2Input('Texte', 'document'), 'title: none | text: Texte');
  assert.equal(gemma.prepareEmbeddingGemma2Input('Text', 'document', '  Book  '), 'title: Book | text: Text');
  assert(gemma.prepareEmbeddingGemma2Input('a'.repeat(16000), 'query').length > 16000);
});
test('padded batches preserve order and isolate long inputs with strict token limit', () => {
  assert.deepEqual(gemma.embeddingGemma2Batches([100, 700, 100, 2100, 100, 8192]), [[0, 1], [2], [3], [4], [5]]);
  assert.deepEqual(gemma.embeddingGemma2Batches(Array(10).fill(10)), [[0, 1, 2, 3, 4, 5, 6, 7], [8, 9]]);
  assert.throws(() => gemma.embeddingGemma2Batches([8193]), /8192 tokens/);
});
test('projection reduction precedes L2; malformed rows are rejected', () => {
  const native = Array(768).fill(0); native[0] = 3; native[1] = 4; native[700] = 100;
  const [result] = gemma.reduceEmbeddingGemma2([native], 1, 256);
  assert.equal(result.length, 256); assert.equal(result[0], .6); assert.equal(result[1], .8);
  assert.throws(() => gemma.reduceEmbeddingGemma2([native.slice(0, 512)], 1, 512));
  assert.throws(() => gemma.reduceEmbeddingGemma2([Array(768).fill(0)], 1, 512));
  assert.throws(() => gemma.reduceEmbeddingGemma2([[NaN, ...native.slice(1)]], 1, 512));
  assert.throws(() => gemma.reduceEmbeddingGemma2([native], 2, 512));
});
test('profiles share only immutable text assets, with hashes for every resource', () => {
  const selected = models.NODUS_LOCAL_MODELS.filter(model => gemma.isEmbeddingGemma2(model.id));
  assert.equal(selected.length, 2);
  assert.equal(selected[0].assetFamily, selected[1].assetFamily);
  assert.deepEqual(selected[0].assets, selected[1].assets);
  for (const asset of selected[0].assets) {
    assert.equal(asset.license, 'Apache-2.0');
    assert.equal(asset.licenseUrl, 'https://ai.google.dev/gemma/apache_2');
    assert.equal(asset.licenseNotice, 'legal/EMBEDDINGGEMMA_2_NOTICE.md');
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert(asset.url.includes(gemma.EMBEDDING_GEMMA2_REVISION));
    assert(!/audio|vision/.test(asset.file));
  }
  assert.equal(models.getNodusLocalModel('multilingual-e5-small-int8').dimensions, 384);
});
test('titles remain aligned through recursive bisection, even for duplicate texts', async () => {
  const titles = ['first', 'second', 'third', 'fourth'];
  const result = await strict.requestEmbeddingBatchWithBisection(['same', 'same', 'same', 'same'], async (texts, offset) => {
    if (texts.length > 1) throw new Error('bisect');
    return [[titles[offset].length, offset + 1]];
  });
  assert.deepEqual(result, [[5, 1], [6, 2], [5, 3], [6, 4]]);
});

test('worker availability preserves the specific oversized-input error in every UI language', () => {
  const source = 'EmbeddingGemma no disponible: EmbeddingGemma: entrada 9 supera el límite de 8192 tokens (incluidos prefijos y tokens especiales).';
  for (const locale of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    const message = language.localizeRuntimeError(source, locale);
    assert.notEqual(message, source);
    assert.match(message, /8192/);
    assert.match(message, /9/);
    assert.doesNotMatch(message, /supera el límite|no disponible/);
  }
});
