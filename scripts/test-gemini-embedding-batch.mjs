import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function load() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-gemini-embeddings-'));
  const output = path.join(directory, 'gemini.mjs');
  await build({ entryPoints: [path.join(root, 'electron/ai/geminiEmbeddings.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return { module: await import(pathToFileURL(output)), directory };
}

test('Gemini native embedding batches preserve model, inputs and request order', async () => {
  const { module, directory } = await load();
  try {
    const body = module.geminiBatchEmbeddingRequest('models/gemini-embedding-001', ['uno', 'dos']);
    assert.deepEqual(body, { requests: [
      { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'uno' }] } },
      { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'dos' }] } },
    ] });
    assert.equal(
      module.geminiBatchEmbeddingEndpoint('gemini-embedding-001'),
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
    );
    assert.deepEqual(module.parseGeminiBatchEmbeddingResponse({ embeddings: [
      { values: [1, 2] }, { values: [3, 4] },
    ] }), [[1, 2], [3, 4]]);
    for (const taskType of ['RETRIEVAL_QUERY', 'RETRIEVAL_DOCUMENT']) {
      const task = module.geminiBatchEmbeddingRequest('gemini-embedding-001', ['pregunta o fuente'], taskType);
      assert.equal(task.requests[0].taskType, taskType);
      assert.equal(task.requests[0].content.parts[0].text, 'pregunta o fuente');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Gemini malformed batch responses fail closed', async () => {
  const { module, directory } = await load();
  try {
    assert.throws(() => module.parseGeminiBatchEmbeddingResponse({}), /lista de embeddings/);
    assert.throws(() => module.parseGeminiBatchEmbeddingResponse({ embeddings: [{ values: null }] }), /posición 0/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
