import { encodeWavPcm16 } from '../audio/wav';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (fraction: number) => void;
  onPartial?: (text: string) => void;
};

export interface LocalWhisperResult {
  text: string;
  chunks: Array<{ text: string; timestamp: [number | null, number | null] | null }>;
}

class WhisperClient {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();

  private getWorker(): Worker {
    let worker = this.worker;
    if (worker) return worker;
    worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const pending = this.pending;
    worker.onmessage = (event: MessageEvent<{ id: string; type: 'progress' | 'partial' | 'result' | 'error'; fraction?: number; text?: string; result?: unknown; error?: string }>) => {
      const current = pending.get(event.data.id);
      if (!current) return;
      if (event.data.type === 'progress') current.onProgress?.(event.data.fraction ?? 0);
      if (event.data.type === 'partial') current.onPartial?.(event.data.text ?? '');
      if (event.data.type === 'result') { pending.delete(event.data.id); current.resolve(event.data.result); }
      if (event.data.type === 'error') { pending.delete(event.data.id); current.reject(new Error(event.data.error ?? 'Whisper local failed')); }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Whisper worker failed');
      pending.forEach((current) => current.reject(error));
      pending.clear();
      worker?.terminate();
      this.worker = null;
    };
    return worker;
  }

  request<T>(message: Record<string, unknown>, transfer: Transferable[] = [], onProgress?: (fraction: number) => void, onPartial?: (text: string) => void): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress, onPartial });
      try { this.getWorker().postMessage({ ...message, id }, transfer); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  cancel(): void {
    this.pending.forEach(current => current.reject(new Error('Transcripción cancelada.')));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}

const client = new WhisperClient();
const request = client.request.bind(client);

/** A dedicated worker keeps the model warm between live phrases. Cancelling this
 * session never kills transcription of a recording in another part of Nodus. */
export function createLocalWhisperDictation(model: string, language: string) {
  const dictation = new WhisperClient();
  return {
    prepare: () => dictation.request<void>({ type: 'ensure', model, localOnly: true }),
    transcribe: async (samples: Float32Array, onPartial: (text: string) => void): Promise<string> => {
      const copy = samples.slice();
      const result = await dictation.request<LocalWhisperResult>({ type: 'transcribe', model, language, samples: copy, localOnly: true }, [copy.buffer], undefined, onPartial);
      return result.text;
    },
    cancel: () => dictation.cancel(),
  };
}

export async function ensureLocalWhisperModel(model: string, onProgress?: (fraction: number) => void): Promise<void> {
  await request({ type: 'ensure', model }, [], onProgress);
  localStorage.setItem(`nodus.stt.model.${model}`, '1');
}

export async function decodeWhisperAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16_000 });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const length = Math.ceil(decoded.duration * 16_000);
    const offline = new OfflineAudioContext(1, length, 16_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    await context.close();
  }
}

export async function transcribeLocalWhisper(blob: Blob, model: string, language?: string | null, onProgress?: (fraction: number) => void, onPartial?: (text: string) => void): Promise<string> {
  return (await transcribeLocalWhisperDetailed(blob, model, language, onProgress, onPartial)).text;
}

export async function transcribeLocalWhisperDetailed(blob: Blob, model: string, language?: string | null, onProgress?: (fraction: number) => void, onPartial?: (text: string) => void): Promise<LocalWhisperResult> {
  const samples = await decodeWhisperAudio(blob);
  const result = await request<LocalWhisperResult | string>({ type: 'transcribe', model, samples, language }, [samples.buffer], onProgress, onPartial);
  return typeof result === 'string' ? { text: result, chunks: [] } : result;
}

export async function audioBlobToWhisperWav(blob: Blob): Promise<Uint8Array> {
  return encodeWavPcm16(await decodeWhisperAudio(blob), 16_000);
}

export function cancelLocalWhisper(): void {
  client.cancel();
}

export function isLocalWhisperModelReady(model: string): boolean {
  return localStorage.getItem(`nodus.stt.model.${model}`) === '1';
}

export async function removeLocalWhisperModel(model: string): Promise<void> {
  localStorage.removeItem(`nodus.stt.model.${model}`);
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames.filter((cacheName) => /transformers/i.test(cacheName))) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      await Promise.all(keys.filter((request) => decodeURIComponent(request.url).includes(model)).map((request) => cache.delete(request)));
    }
  } catch {
    // Cache APIs vary by Electron version; the model is still unregistered locally.
  }
  client.cancel();
}

export async function localWhisperStorageBytes(model: string): Promise<number> {
  let total = 0;
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames.filter((cacheName) => /transformers/i.test(cacheName))) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      for (const request of keys.filter((item) => decodeURIComponent(item.url).includes(model))) {
        const response = await cache.match(request);
        total += Number(response?.headers.get('content-length') ?? 0);
      }
    }
  } catch {
    return 0;
  }
  return total;
}
