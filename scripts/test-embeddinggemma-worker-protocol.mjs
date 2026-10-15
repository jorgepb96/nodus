import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';

test('EmbeddingGemma worker rejects unknown operations before model loading', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-eg2-protocol-'));
  let worker;
  try {
    const file = path.join(root, 'embeddingGemma2Worker.cjs');
    await build({ entryPoints: ['electron/workers/embeddingGemma2Worker.ts'], outfile: file, bundle: true,
      platform: 'node', format: 'cjs', external: ['@nodus/embeddinggemma-transformers'], logLevel: 'silent' });
    worker = new Worker(file, { workerData: { directory: root, threads: 1, dtype: 'q8' } });
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker protocol response timeout')), 2_000);
      worker.once('message', message => { clearTimeout(timer); resolve(message); });
    });
    worker.postMessage({ id: 41, operation: 'skip-plan', texts: ['fixture'], dimensions: 512 });
    const message = await response;
    assert.equal(message.id, 41); assert.equal(message.ok, false);
    assert.match(message.error, /operación de proceso desconocida/u);
  } finally {
    if (worker) await worker.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
