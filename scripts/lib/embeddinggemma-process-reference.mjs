import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { EMBEDDING_GEMMA_PROCESS_FIXTURES as fixtures, EMBEDDING_GEMMA_PROCESS_PROFILES as profileIds } from './embeddinggemma-process-fixtures.mjs';

const getArg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const root = fs.realpathSync(getArg('root'));
const workerFile = path.join(root, 'embeddingGemma2Worker.cjs');
const modelDir = path.join(root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1');
const { prepareEmbeddingGemma2Input, embeddingGemma2Contract } = await import(pathToFileURL(path.join(root, 'embeddingGemma2-contract.mjs')));
const threads = Math.max(1, Math.min(4, os.availableParallelism() - 1));
const result = { profiles: {}, embeddingContracts: Object.fromEntries(profileIds.map(id => [id, embeddingGemma2Contract(id)])),
  fixtureCount: fixtures.length, threads, runtime: { electron: process.versions.electron, node: process.versions.node,
    platform: process.platform, architecture: process.arch } };
const worker = new Worker(workerFile, { workerData: { directory: modelDir, dtype: 'q8', threads } });
let nextId = 0;
function request(operation, texts, dimensions) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.off('message', receive); reject(new Error('reference worker timeout')); }, 600_000);
    const receive = message => {
      if (message.id !== id) return;
      clearTimeout(timer); worker.off('message', receive);
      if (message.ok) resolve(message.result); else reject(new Error(message.error || 'reference worker failed'));
    };
    worker.on('message', receive); worker.postMessage({ id, operation, texts, dimensions });
  });
}
try {
  const docs = fixtures.filter(item => item.role === 'document');
  const queries = fixtures.filter(item => item.role === 'query');
  const prepared = { document: docs.map(item => prepareEmbeddingGemma2Input(item.text, 'document', item.title)),
    query: queries.map(item => prepareEmbeddingGemma2Input(item.text, 'query')) };
  for (const profile of profileIds) {
    const dimension = Number(profile.match(/-(256|512)-v1$/u)?.[1]);
    const vectors = [];
    for (const role of ['document', 'query']) {
      const texts = prepared[role];
      const batches = await request('plan', texts, dimension);
      const group = Array(texts.length);
      for (const indices of batches) {
        const output = await request('infer', indices.map(index => texts[index]), dimension);
        indices.forEach((index, row) => { group[index] = output[row]; });
      }
      vectors.push(...group);
    }
    result.profiles[profile] = vectors;
  }
  process.stdout.write(JSON.stringify(result));
} finally { await worker.terminate(); }
