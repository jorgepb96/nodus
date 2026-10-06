const { parentPort, workerData } = require('node:worker_threads');
let ready;
parentPort.on('message', async request => {
  try {
    ready ??= (async () => {
      const { env, pipeline } = await import('@huggingface/transformers');
      env.allowRemoteModels = false; env.allowLocalModels = true; env.cacheDir = workerData.directory;
      return pipeline('feature-extraction', workerData.directory, { dtype: 'int8', device: 'cpu', local_files_only: true, session_options: { intraOpNumThreads: workerData.threads, interOpNumThreads: 1 } });
    })();
    const extractor = await ready;
    const output = await extractor(request.texts, { pooling: 'mean', normalize: true });
    parentPort.postMessage({ id: request.id, ok: true, result: output.tolist() });
  } catch (error) { parentPort.postMessage({ id: request.id, ok: false, error: error.message }); }
});
