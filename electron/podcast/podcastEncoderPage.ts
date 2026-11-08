// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page the hidden encoder window loads. WebCodecs only exists in a renderer with a secure
 * context, so the main process streams PCM here in base64 chunks and gets encoded packets
 * back; muxing happens in the main process (shared/audio). The page has no network, no
 * preload and no access to anything but the data it is handed.
 *
 * AAC in Chromium accepts 44.1 and 48 kHz only, and the voices write 24 kHz, so the page
 * resamples with a windowed sinc (Lanczos, 16 taps) before encoding. Opus takes 48 kHz too.
 */
export const PODCAST_ENCODER_HTML = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'">
<title>Podcast encoder</title>
<script>
(() => {
  const TAPS = 8;
  let encoder = null, codec = '', outRate = 0, inRate = 0, ratio = 1, description = null, failure = null;
  let frames = [], durations = [], encodedSamples = 0;
  let buffer = new Float32Array(0), base = 0, nextOut = 0, totalIn = 0;

  const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const kernel = (x) => (Math.abs(x) >= TAPS ? 0 : sinc(x) * sinc(x / TAPS));

  function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function toBase64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }

  function resample(input, final) {
    if (ratio === 1) return input;
    const joined = new Float32Array(buffer.length + input.length);
    joined.set(buffer); joined.set(input, buffer.length);
    buffer = joined;
    totalIn += input.length;
    const out = [];
    const end = final ? Math.floor(totalIn * ratio) : Infinity;
    for (;;) {
      if (nextOut >= end) break;
      const t = nextOut / ratio;
      const center = Math.floor(t);
      if (!final && center + TAPS >= base + buffer.length) break;
      let sum = 0, weight = 0;
      for (let k = center - TAPS + 1; k <= center + TAPS; k += 1) {
        const w = kernel(t - k);
        const index = k - base;
        const value = index >= 0 && index < buffer.length ? buffer[index] : 0;
        sum += value * w; weight += w;
      }
      out.push(weight ? sum / weight : 0);
      nextOut += 1;
    }
    const keepFrom = Math.max(0, Math.floor(nextOut / ratio) - TAPS - 1 - base);
    if (keepFrom > 0) { buffer = buffer.slice(keepFrom); base += keepFrom; }
    return Float32Array.from(out);
  }

  function encode(samples) {
    if (!samples.length) return;
    const data = new AudioData({ format: 'f32-planar', sampleRate: outRate, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: Math.round((encodedSamples * 1e6) / outRate), data: samples });
    encoder.encode(data);
    data.close();
    encodedSamples += samples.length;
  }

  function drain() {
    if (failure) throw failure;
    const size = frames.reduce((sum, frame) => sum + frame.length, 0);
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const frame of frames) { joined.set(frame, offset); offset += frame.length; }
    const result = { data: toBase64(joined), sizes: frames.map((frame) => frame.length), durations };
    frames = []; durations = [];
    return result;
  }

  async function backpressure() {
    while (encoder.encodeQueueSize > 64) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  window.podcastEncoder = {
    async init(sampleRate, channels, bitrate) {
      if (channels !== 1) throw new Error('PODCAST_ENCODER_MONO_ONLY');
      inRate = sampleRate;
      const aacRate = [48000, 44100].includes(sampleRate) ? sampleRate : [48000, 44100].includes(sampleRate * 2) ? sampleRate * 2 : 48000;
      const aac = { codec: 'mp4a.40.2', sampleRate: aacRate, numberOfChannels: 1, bitrate };
      const opus = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: Math.min(bitrate, 48000) };
      let config = null;
      try { if ((await AudioEncoder.isConfigSupported(aac)).supported) { config = aac; codec = 'aac'; } } catch (error) { /* try Opus */ }
      if (!config) {
        try { if ((await AudioEncoder.isConfigSupported(opus)).supported) { config = opus; codec = 'opus'; } } catch (error) { /* none */ }
      }
      if (!config) throw new Error('PODCAST_NO_AUDIO_ENCODER');
      outRate = config.sampleRate;
      ratio = outRate / inRate;
      encoder = new AudioEncoder({
        output: (chunk, meta) => {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          frames.push(bytes);
          durations.push(chunk.duration || 0);
          const described = meta && meta.decoderConfig && meta.decoderConfig.description;
          if (described && !description) description = new Uint8Array(described instanceof ArrayBuffer ? described : described.buffer.slice(described.byteOffset, described.byteOffset + described.byteLength));
        },
        error: (error) => { failure = error; },
      });
      encoder.configure(config);
      return { codec, outRate };
    },
    async push(base64) {
      const bytes = fromBase64(base64);
      const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
      const floats = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i += 1) floats[i] = pcm[i] / 32768;
      encode(resample(floats, false));
      await backpressure();
      return drain();
    },
    async finish() {
      encode(resample(new Float32Array(0), true));
      await encoder.flush();
      const rest = drain();
      encoder.close();
      return { ...rest, description: description ? toBase64(description) : '', codec, outRate };
    },
  };
})();
</script>`;
