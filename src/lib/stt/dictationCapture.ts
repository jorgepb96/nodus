import captureWorkletUrl from './dictation.worklet.js?url&no-inline';

export interface DictationCapture {
  sampleRate: number;
  pause(): Promise<void>;
  resume(): void;
  close(): Promise<void>;
}

/** The caller owns the microphone stream, including pending permission requests. */
export async function createDictationCapture(stream: MediaStream, onSamples: (samples: Float32Array) => void): Promise<DictationCapture> {
  const context = new AudioContext({ sampleRate: 16_000 });
  try {
    await context.audioWorklet.addModule(captureWorkletUrl);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'nodus-dictation-capture');
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(node).connect(silent).connect(context.destination);
    const flushes = new Map<string, () => void>();
    node.port.onmessage = ({ data }) => {
      if (data.type === 'samples') onSamples(data.samples);
      else if (data.type === 'flushed') { flushes.get(data.id)?.(); flushes.delete(data.id); }
    };
    await context.resume();
    let closed = false;
    return {
      sampleRate: context.sampleRate,
      pause: () => closed ? Promise.resolve() : new Promise<void>(resolve => {
        const id = crypto.randomUUID();
        const timer = window.setTimeout(() => { flushes.delete(id); resolve(); }, 500);
        flushes.set(id, () => { window.clearTimeout(timer); resolve(); });
        node.port.postMessage({ type: 'pause', id });
      }),
      resume: () => { if (!closed) node.port.postMessage({ type: 'resume' }); },
      close: async () => {
        if (closed) return;
        closed = true;
        node.port.onmessage = null;
        for (const resolve of flushes.values()) resolve();
        flushes.clear();
        node.disconnect(); source.disconnect(); silent.disconnect(); node.port.close();
        await context.close();
      },
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}
