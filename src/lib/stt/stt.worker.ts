/// <reference lib="webworker" />
import { env, pipeline, WhisperTextStreamer } from '@huggingface/transformers';
import { whisperLanguageName } from '@shared/sttModels';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Ship the inference runtime with Nodus as well: an installed model must work
// offline, including the first dictation after restarting the application.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    wasm: new URL('../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href,
    mjs: new URL('../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', import.meta.url).href,
  };
}

type WorkerRequest =
  | { id: string; type: 'ensure'; model: string; localOnly?: boolean }
  | { id: string; type: 'transcribe'; model: string; samples: Float32Array; language?: string | null; localOnly?: boolean };

type AsrPipeline = ((samples: Float32Array, options: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
}>) & { tokenizer: ConstructorParameters<typeof WhisperTextStreamer>[0] };
const pipelines = new Map<string, AsrPipeline>();

async function getPipeline(id: string, model: string, localOnly = false) {
  const existing = pipelines.get(model);
  if (existing) return existing;
  env.allowLocalModels = localOnly;
  env.allowRemoteModels = !localOnly;
  const created = await pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: 'q8',
    local_files_only: localOnly,
    progress_callback: (progress: { status?: string; progress?: number; loaded?: number; total?: number }) => {
      const fraction = typeof progress.progress === 'number'
        ? progress.progress / 100
        : progress.total ? (progress.loaded ?? 0) / progress.total : 0;
      self.postMessage({ id, type: 'progress', fraction: Math.max(0, Math.min(1, fraction)) });
    },
  });
  const transcriber = created as unknown as AsrPipeline;
  pipelines.set(model, transcriber);
  return transcriber;
}

async function handleRequest(request: WorkerRequest) {
  try {
    const transcriber = await getPipeline(request.id, request.model, request.localOnly);
    if (request.type === 'ensure') {
      self.postMessage({ id: request.id, type: 'result', result: true });
      return;
    }
    let partial = '';
    const durationSeconds = request.samples.length / 16_000;
    const streamer = new WhisperTextStreamer(transcriber.tokenizer, {
      skip_prompt: true,
      callback_function: (delta) => {
        partial += delta;
        self.postMessage({ id: request.id, type: 'partial', text: partial.trimStart() });
      },
      on_chunk_end: (seconds) => {
        if (durationSeconds > 0) self.postMessage({ id: request.id, type: 'progress', fraction: Math.min(0.98, seconds / durationSeconds) });
      },
    });
    const output = await transcriber(request.samples, {
      language: request.language ? whisperLanguageName(request.language) : undefined,
      task: 'transcribe',
      chunk_length_s: 25,
      stride_length_s: 4,
      return_timestamps: true,
      streamer,
    });
    self.postMessage({
      id: request.id,
      type: 'result',
      result: {
        text: output.text?.trim() ?? '',
        chunks: (output.chunks ?? []).map((chunk) => ({
          text: chunk.text?.trim() ?? '',
          timestamp: chunk.timestamp ?? null,
        })),
      },
    });
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

// The pipeline and its environment are mutable; never run two requests at once.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handleRequest(event.data));
};

export {};
