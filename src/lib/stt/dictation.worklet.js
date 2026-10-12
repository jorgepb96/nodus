// Runs on the audio rendering thread. Each message contains complete PCM frames,
// unlike MediaRecorder timeslices which cannot be decoded independently.
class DictationCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.paused = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'resume') this.paused = false;
      else {
        this.send();
        this.paused = true;
        this.port.postMessage({ type: 'flushed', id: data.id });
      }
    };
  }
  send() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!this.paused && input?.[0]) {
      for (let i = 0; i < input[0].length; i++) {
        let mono = 0;
        for (const channel of input) mono += channel[i];
        this.buffer[this.offset++] = mono / input.length;
        if (this.offset === this.buffer.length) this.send();
      }
    }
    return true;
  }
}
registerProcessor('nodus-dictation-capture', DictationCaptureProcessor);
