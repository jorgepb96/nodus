// SPDX-License-Identifier: AGPL-3.0-only
import { encodeWavPcm16 } from '../audio/wav';

/**
 * Turns a recording or an uploaded file into the reference Ming clones best from: mono,
 * 44.1 kHz, leading and trailing silence trimmed (a little kept so words are not clipped)
 * and peak-normalized. Decoding and resampling run inside the browser's audio engine
 * (`OfflineAudioContext`), off the main thread; the remaining loops touch a few hundred
 * thousand samples and take milliseconds.
 */
export const REFERENCE_SAMPLE_RATE = 44_100;

export interface PreparedVoice { wav: Uint8Array; durationS: number; peak: number }

export async function prepareReferenceAudio(blob: Blob): Promise<PreparedVoice> {
  const encoded = await blob.arrayBuffer();
  const probe = new OfflineAudioContext(1, 1, REFERENCE_SAMPLE_RATE);
  const decoded = await probe.decodeAudioData(encoded.slice(0));
  const frames = Math.ceil(decoded.duration * REFERENCE_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, Math.max(1, frames), REFERENCE_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const trimmed = trimSilence(rendered.getChannelData(0), REFERENCE_SAMPLE_RATE);
  const { samples, peak } = normalizePeak(trimmed, 0.89);
  return { wav: encodeWavPcm16(samples, REFERENCE_SAMPLE_RATE), durationS: samples.length / REFERENCE_SAMPLE_RATE, peak };
}

/** Removes silence before the first and after the last voiced 20 ms window (−45 dBFS), keeping 150 ms of margin. */
export function trimSilence(samples: Float32Array, sampleRate: number, thresholdDb = -45, marginMs = 150): Float32Array {
  const window = Math.max(1, Math.round(sampleRate * 0.02));
  const threshold = 10 ** (thresholdDb / 20);
  const voiced = (start: number) => {
    let sum = 0;
    const end = Math.min(samples.length, start + window);
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, end - start)) > threshold;
  };
  let first = 0;
  while (first < samples.length && !voiced(first)) first += window;
  let last = samples.length - window;
  while (last > first && !voiced(last)) last -= window;
  if (first >= samples.length) return samples.slice(0, 0);
  const margin = Math.round((sampleRate * marginMs) / 1000);
  return samples.slice(Math.max(0, first - margin), Math.min(samples.length, last + window + margin));
}

export function normalizePeak(samples: Float32Array, target: number): { samples: Float32Array; peak: number } {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4) return { samples, peak };
  const gain = Math.min(8, target / peak);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * gain;
  return { samples: out, peak };
}
