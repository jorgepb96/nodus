/** Remove marked sound captions, preserving the ordinary spoken word “música”. */
export function cleanDictationText(text: string, final = false): string {
  const clean = text
    .replace(/\[(?:[^\]]*(?:m[uú]sica|music|silencio|silence|aplausos|applause|ruido|noise|blank_audio|inaudible|sound)[^\]]*)\]|\((?:m[uú]sica|music|silencio|silence|aplausos|applause|ruido|noise)[^)]*\)|[♪♫]+/giu, ' ')
    .replace(/<\|[^>]+\|>/gu, ' ').replace(/\s+/gu, ' ').trim();
  // The artificial end of a growing window is not a sentence boundary.
  return final ? clean : clean.replace(/[.!?…]+["”’]*$/u, '').trimEnd();
}
type Window = { id: number; samples: Float32Array; final: boolean; sentenceEnd: boolean; overlap: boolean };

export function removeDictationOverlap(text: string, previous: string): string {
  const words = [...text.matchAll(/\S+/gu)];
  const normalize = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const before = previous.split(/\s+/u).map(normalize);
  for (let size = Math.min(20, words.length, before.length); size > 0; size--) {
    if (words.slice(0, size).every((word, index) => normalize(word[0]) === before[before.length - size + index])) return text.slice(words[size - 1].index! + words[size - 1][0].length).trimStart();
  }
  return text;
}

/** Incomplete audio can make Whisper loop a short phrase hundreds of times.
 * Discard that hypothesis, keeping the last usable words until the next decode. */
export function implausibleDictation(text: string, seconds: number): boolean {
  const words = text.toLocaleLowerCase().split(/\s+/u);
  if (words.length > Math.max(16, seconds * 8)) return true;
  for (let size = 2; size <= 5; size++) {
    let repeated = 0;
    for (let i = size; i < words.length; i++) {
      repeated = words[i] === words[i - size] ? repeated + 1 : 0;
      if (repeated >= Math.max(12, size * 4)) return true;
    }
  }
  return false;
}

/** Rolling utterance hypotheses, with one inference at a time. Intermediate
 * snapshots are coalesced. The editor replaces the evolving utterance instead
 * of appending independent chunks, keeping sentence context until a real pause. */
export class LiveDictationSession {
  private frames: Float32Array[] = [];
  private length = 0;
  private voiced = 0;
  private silence = 0;
  private submitted = 0;
  private id = 0;
  private overlap = false;
  private previousText = '';
  private queue: Window[] = [];
  private inFlight: Window | null = null;
  private running: Promise<void> | null = null;
  private published = new Map<number, string>();
  private mode: 'listening' | 'paused' | 'stopped' | 'cancelled' = 'listening';

  constructor(private options: {
    sampleRate: number;
    transcribe(samples: Float32Array, onPartial: (text: string) => void, final: boolean): Promise<string>;
    onUpdate(text: string, utteranceId: number, final: boolean): void;
    onText?(text: string, samples: Float32Array): void | Promise<void>;
    onPending?(seconds: number): void;
    onBackpressure?(): void;
    onError(error: unknown): void;
  }) {}

  push(samples: Float32Array): void {
    if (this.mode !== 'listening' || !samples.length) return;
    const rate = this.options.sampleRate;
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const speech = Math.sqrt(energy / samples.length) >= 0.012;
    this.frames.push(samples.slice()); this.length += samples.length;
    if (speech) { this.voiced += samples.length; this.silence = 0; }
    else this.silence += samples.length;
    if (!this.voiced) {
      while (this.frames.length > 1 && this.length - this.frames[0].length >= rate * 0.25) this.length -= this.frames.shift()!.length;
      return;
    }
    if (this.silence >= rate * 1.2) this.flush();
    else if (this.length >= rate * 24) this.flush(false);
    else if (this.voiced >= rate * 0.35 && this.length >= rate * 0.8 && this.length - this.submitted >= rate * 0.5 && this.silence < rate * 0.3) this.schedule(false, false);
    if (this.pendingSamples() >= rate * 30 && this.mode === 'listening') {
      this.mode = 'paused'; this.flush(); this.options.onBackpressure?.();
    }
  }
  private snapshot(): Float32Array {
    // Long silent tails invite invented captions; retain only 300 ms of them.
    const size = this.length - Math.max(0, this.silence - this.options.sampleRate * 0.3);
    const samples = new Float32Array(size);
    let offset = 0;
    for (const frame of this.frames) {
      const part = frame.subarray(0, Math.min(frame.length, size - offset));
      samples.set(part, offset); offset += part.length;
      if (offset === size) break;
    }
    return samples;
  }
  private schedule(final: boolean, sentenceEnd: boolean): void {
    if (this.voiced < this.options.sampleRate * 0.1) return;
    const next = { id: this.id, samples: this.snapshot(), final, sentenceEnd, overlap: this.overlap };
    if (final && this.inFlight?.id === this.id && this.inFlight.samples.length === next.samples.length) {
      this.inFlight.final = true; this.inFlight.sentenceEnd = sentenceEnd; return;
    }
    const pending = this.queue.findIndex(window => window.id === this.id);
    if (pending >= 0) this.queue[pending] = next;
    else this.queue.push(next);
    this.submitted = this.length; this.reportPending(); this.pump();
  }
  flush(sentenceEnd = true): void {
    if (this.mode === 'cancelled') return;
    const context = !sentenceEnd ? this.snapshot().slice(-Math.round(this.options.sampleRate * 1.5)) : null;
    this.schedule(true, sentenceEnd);
    this.frames = []; this.length = 0; this.voiced = 0; this.silence = 0; this.submitted = 0; this.id++;
    this.overlap = Boolean(context);
    if (context?.length) {
      // Carry audio across the model's finite window, including the last word
      // that may have been cut in half. It is reconciled against the prior tail.
      this.frames = [context]; this.length = context.length; this.voiced = context.length; this.submitted = context.length;
    }
  }
  pause(): void { if (this.mode === 'listening') { this.mode = 'paused'; this.flush(); } }
  resume(): boolean {
    if (this.mode !== 'paused' || this.pendingSamples() >= this.options.sampleRate * 30) return false;
    this.mode = 'listening'; return true;
  }
  async stop(): Promise<void> {
    if (this.mode === 'cancelled') return;
    this.mode = 'stopped'; this.flush();
    while (this.running) await this.running;
  }
  cancel(): void {
    this.mode = 'cancelled'; this.queue = []; this.frames = []; this.length = 0;
    this.published.clear(); this.reportPending();
  }
  private pendingSamples(): number {
    const byId = new Map(this.queue.map(window => [window.id, window.samples.length]));
    if (this.inFlight) byId.set(this.inFlight.id, Math.max(byId.get(this.inFlight.id) ?? 0, this.inFlight.samples.length));
    if (this.voiced) byId.set(this.id, Math.max(byId.get(this.id) ?? 0, this.length));
    return [...byId.values()].reduce((sum, length) => sum + length, 0);
  }
  private reportPending(): void { this.options.onPending?.(this.mode === 'cancelled' ? 0 : this.pendingSamples() / this.options.sampleRate); }
  private isCancelled(): boolean { return this.mode === 'cancelled'; }
  private publish(window: Window, value: string, streaming = false): void {
    if (this.isCancelled()) return;
    let text = cleanDictationText(value, window.final && window.sentenceEnd && !streaming);
    if (window.overlap) text = removeDictationOverlap(text, this.previousText);
    if (window.final && !window.sentenceEnd && !streaming) text = text.replace(/\s+\S+$/u, '');
    const previous = this.published.get(window.id) ?? '';
    if (implausibleDictation(text, window.samples.length / this.options.sampleRate) || !text && previous) {
      if (window.final && !streaming) this.options.onUpdate(previous, window.id, true);
      return;
    }
    // Token streams replay earlier words. Do not erase and retype them while
    // this decoder is catching up with the previous window's hypothesis.
    if (streaming && (text.length <= previous.length || !text.startsWith(previous))) return;
    if (text !== previous || window.final && !streaming) {
      this.published.set(window.id, text);
      this.options.onUpdate(text, window.id, window.final && !streaming);
    }
  }
  private pump(): void {
    if (this.running || !this.queue.length || this.isCancelled()) return;
    this.running = this.drain().finally(() => { this.running = null; this.pump(); });
  }
  private async drain(): Promise<void> {
    while (this.queue.length && !this.isCancelled()) {
      const window = this.queue.shift()!; this.inFlight = window;
      try {
        const text = await this.options.transcribe(window.samples, value => this.publish(window, value, true), window.final);
        if (this.isCancelled()) return;
        this.publish(window, text);
        if (window.final) {
          const clean = this.published.get(window.id) ?? '';
          this.previousText = clean;
          if (clean) await this.options.onText?.(clean, window.samples);
          this.published.delete(window.id);
        }
      } catch (error) {
        if (!this.isCancelled()) { this.cancel(); this.options.onError(error); }
        return;
      } finally { this.inFlight = null; this.reportPending(); }
    }
  }
}
