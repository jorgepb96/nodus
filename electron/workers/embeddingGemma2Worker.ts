import { parentPort, workerData } from 'node:worker_threads';
import { embeddingGemma2Batches, reduceEmbeddingGemma2 } from '../../shared/embeddingGemma2';

let runtime: Promise<{ tokenizer: any; model: any }> | undefined;
async function load() {
  return runtime ??= (async () => {
    const { env, AutoConfig, AutoModel, AutoTokenizer } = await import('@nodus/embeddinggemma-transformers');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.cacheDir = workerData.directory;
    const options = { local_files_only: true };
    const config: any = await AutoConfig.from_pretrained(workerData.directory, options);
    config.vision_config = config.audio_config = null;
    const tokenizer = await AutoTokenizer.from_pretrained(workerData.directory, options);
    const model = await AutoModel.from_pretrained(workerData.directory, {
      ...options, config, device: 'cpu', dtype: workerData.dtype ?? 'q8',
      session_options: { intraOpNumThreads: workerData.threads, interOpNumThreads: 1 },
    });
    return { tokenizer, model };
  })();
}

// The host sends one operation at a time. Native inference never blocks Electron's UI.
parentPort!.on('message', async (request: { id: number; operation: 'plan' | 'infer'; texts: string[]; dimensions: number }) => {
  try {
    const { tokenizer, model } = await load();
    const lengths = request.texts.map(text => tokenizer(text, { truncation: false, padding: false }).input_ids.dims.at(-1));
    const batches = embeddingGemma2Batches(lengths);
    if (request.operation === 'plan') {
      parentPort!.postMessage({ id: request.id, ok: true, result: batches });
      return;
    }
    if (batches.length !== 1) throw new Error('EmbeddingGemma: lote excede el presupuesto de tokens.');
    const inputs = tokenizer(request.texts, { padding: true, truncation: false });
    const { sentence_embedding } = await model(inputs);
    const vectors = reduceEmbeddingGemma2(sentence_embedding.tolist(), request.texts.length, request.dimensions);
    parentPort!.postMessage({ id: request.id, ok: true, result: vectors });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
