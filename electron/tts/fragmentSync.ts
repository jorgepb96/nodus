// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { detectPauses, fragmentOffsets, type ClipSync, type Pause } from '@shared/narrationSync';
import { CLIP_FRAGMENT_GAP_MS, pcmChunk } from './wavConcat';

/**
 * The audio facts the read-along highlight needs: where each fragment is silent, and where
 * the fragments of a saved clip start. Reading a fragment and scanning its PCM costs about a
 * millisecond per ten seconds of audio, so it runs in main without a worker.
 */

/** Silences of one PCM16 WAV; none when the file is not one (old or foreign audio). */
export function pausesOfWav(bytes: Buffer): Pause[] {
  try {
    const chunk = pcmChunk(bytes);
    if (chunk.bitsPerSample !== 16 || !chunk.channels) return [];
    // Int16Array needs an even byte offset; a pooled Buffer may not give one.
    const data = chunk.data.byteOffset % 2 ? Buffer.from(chunk.data) : chunk.data;
    const interleaved = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
    if (chunk.channels === 1) return detectPauses(interleaved, chunk.sampleRate);
    const mono = new Int16Array(Math.floor(interleaved.length / chunk.channels));
    for (let i = 0; i < mono.length; i += 1) mono[i] = interleaved[i * chunk.channels];
    return detectPauses(mono, chunk.sampleRate);
  } catch {
    return [];
  }
}

export async function pausesOfWavFile(filePath: string): Promise<Pause[]> {
  try { return pausesOfWav(await fs.readFile(filePath)); } catch { return []; }
}

/** The sync map of a clip joined by `concatWavFiles` from these fragments, in this order. */
export function clipSyncFor(fragments: ReadonlyArray<{ durationS: number; text: string; pauses: Pause[] }>): ClipSync {
  const gapS = CLIP_FRAGMENT_GAP_MS / 1000;
  const offsets = fragmentOffsets(fragments.map((fragment) => fragment.durationS), gapS);
  return {
    version: 1,
    gapS,
    fragments: fragments.map((fragment, index) => ({ offsetS: offsets[index], durationS: fragment.durationS, text: fragment.text, pauses: fragment.pauses })),
  };
}
