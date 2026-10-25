import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(require.resolve('@nodus/embeddinggemma-transformers'));
const ort = runtimeRequire('onnxruntime-node');
test('Harrier WASM graph preserves upstream uint8 block-gather values', async () => {
  let reference;
  for (const name of ['reference', 'standard']) {
    const session = await ort.InferenceSession.create(fileURLToPath(new URL(`./fixtures/zotero-embeddings/gather-${name}.onnx`, import.meta.url)), { executionProviders: ['cpu'], intraOpNumThreads: 1 });
    try {
      const result = await session.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from([0n, 7n, 3n]), [1, 3]) });
      const data = Object.values(result)[0].data;
      if (!reference) reference = Array.from(data);
      else {
        assert.equal(data.length, reference.length);
        for (let i = 0; i < data.length; i++) assert.ok(Math.abs(data[i] - reference[i]) < 0.00002, `different dequantized value at ${i}`);
      }
    } finally { await session.release(); }
  }
});
