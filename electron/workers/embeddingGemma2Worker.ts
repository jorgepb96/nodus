import path from 'node:path';
import { workerData } from 'node:worker_threads';
import { parentPort } from './backgroundParentPort';
import { embeddingGemma2Batches, reduceEmbeddingGemma2 } from '../../shared/embeddingGemma2';

interface Configuration { directory: string; threads: number; dtype: 'q8' | 'q4' }
interface Request {
  id: number; operation: 'init' | 'plan' | 'infer'; texts?: string[]; dimensions?: number;
  directory?: string; threads?: number; dtype?: 'q8' | 'q4';
}
// Direct worker-thread QA fixtures still pass their configuration in
// workerData. The product host always sends the same fields over IPC first.
const fixtureConfiguration = workerData as Partial<Configuration> | undefined;
let configuration: Configuration | null = fixtureConfiguration
  && validDirectory(fixtureConfiguration.directory)
  && Number.isInteger(fixtureConfiguration.threads)
  && fixtureConfiguration.threads! >= 1 && fixtureConfiguration.threads! <= 4
  && (fixtureConfiguration.dtype === undefined || fixtureConfiguration.dtype === 'q8' || fixtureConfiguration.dtype === 'q4')
  ? { directory: fixtureConfiguration.directory!, threads: fixtureConfiguration.threads!, dtype: fixtureConfiguration.dtype ?? 'q8' } : null;
let runtime: Promise<{ tokenizer: any; model: any }> | undefined;

async function load() {
  return runtime ??= (async () => {
    if (!configuration) throw new Error('EmbeddingGemma: falta configuración del proceso aislado.');
    const { env, AutoConfig, AutoModel, AutoTokenizer } = await import('@nodus/embeddinggemma-transformers');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.cacheDir = configuration.directory;
    const options = { local_files_only: true };
    const config: any = await AutoConfig.from_pretrained(configuration.directory, options);
    config.vision_config = config.audio_config = null;
    const tokenizer = await AutoTokenizer.from_pretrained(configuration.directory, options);
    const model = await AutoModel.from_pretrained(configuration.directory, {
      ...options, config, device: 'cpu', dtype: configuration.dtype,
      session_options: { intraOpNumThreads: configuration.threads, interOpNumThreads: 1 },
    });
    return { tokenizer, model };
  })();
}

function validDirectory(value: unknown): value is string {
  return typeof value === 'string' && path.isAbsolute(value);
}

// Configuration crosses IPC before the first plan, including when this module
// runs as a worker thread nested inside Electron's utility process.
parentPort!.on('message', async (request: Request) => {
  if (request.operation === 'init') {
    if (configuration || !validDirectory(request.directory) || !Number.isInteger(request.threads)
        || request.threads! < 1 || request.threads! > 4 || request.dtype !== 'q8') {
      parentPort!.postMessage({ id: 0, operation: 'error', error: 'EmbeddingGemma: configuración de proceso inválida.' });
      return;
    }
    configuration = { directory: request.directory, threads: request.threads!, dtype: request.dtype };
    parentPort!.postMessage({ id: 0, operation: 'ready' });
    return;
  }
  try {
    if (request.operation !== 'plan' && request.operation !== 'infer') {
      throw new Error('EmbeddingGemma: operación de proceso desconocida.');
    }
    if (!configuration || !Array.isArray(request.texts) || !Number.isInteger(request.dimensions)) {
      throw new Error('EmbeddingGemma: solicitud de proceso inválida.');
    }
    let loaded: { tokenizer: any; model: any };
    try { loaded = await load(); }
    catch (error) {
      parentPort!.postMessage({ id: request.id, ok: false, fatal: true,
        error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const { tokenizer, model } = loaded;
    const lengths = request.texts.map(text => tokenizer(text, { truncation: false, padding: false }).input_ids.dims.at(-1));
    const batches = embeddingGemma2Batches(lengths);
    if (request.operation === 'plan') {
      parentPort!.postMessage({ id: request.id, ok: true, result: batches });
      return;
    }
    if (batches.length !== 1) throw new Error('EmbeddingGemma: lote excede el presupuesto de tokens.');
    const inputs = tokenizer(request.texts, { padding: true, truncation: false });
    let sentence_embedding: any;
    try { ({ sentence_embedding } = await model(inputs)); }
    catch (error) {
      parentPort!.postMessage({ id: request.id, ok: false, fatal: true,
        error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const vectors = reduceEmbeddingGemma2(sentence_embedding.tolist(), request.texts.length, request.dimensions!);
    parentPort!.postMessage({ id: request.id, ok: true, result: vectors });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, ok: false, fatal: false, error: error instanceof Error ? error.message : String(error) });
  }
});
