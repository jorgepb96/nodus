// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';

/**
 * Joins the PCM WAV fragments of one narration segment into a single clip. The sidecar writes
 * fragments with the same format, so this is header surgery and one buffer copy: no decoding,
 * no resampling, nothing that could keep the main thread busy for more than a few ms.
 */
interface PcmChunk { sampleRate: number; channels: number; bitsPerSample: number; data: Buffer }

export function pcmChunk(buffer: Buffer): PcmChunk {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('TTS_BAD_FRAGMENT');
  let offset = 12;
  let format: Omit<PcmChunk, 'data'> | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      if (buffer.readUInt16LE(offset + 8) !== 1) throw new Error('TTS_BAD_FRAGMENT');
      format = { channels: buffer.readUInt16LE(offset + 10), sampleRate: buffer.readUInt32LE(offset + 12), bitsPerSample: buffer.readUInt16LE(offset + 22) };
    } else if (id === 'data' && format) {
      return { ...format, data: buffer.subarray(offset + 8, Math.min(buffer.length, offset + 8 + size)) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('TTS_BAD_FRAGMENT');
}

export function wavFromPcm(sampleRate: number, channels: number, bitsPerSample: number, data: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Silence between the fragments of a saved clip. Clip sync maps (`ClipSync.gapS`) use it too. */
export const CLIP_FRAGMENT_GAP_MS = 120;

/** Concatenate fragment files, with `gapMs` of silence between them for a natural pause. */
export async function concatWavFiles(paths: readonly string[], gapMs = CLIP_FRAGMENT_GAP_MS): Promise<Buffer> {
  if (!paths.length) throw new Error('TTS_NO_FRAGMENTS');
  const chunks = await Promise.all(paths.map(async (file) => pcmChunk(await fs.readFile(file))));
  const { sampleRate, channels, bitsPerSample } = chunks[0];
  if (chunks.some((chunk) => chunk.sampleRate !== sampleRate || chunk.channels !== channels || chunk.bitsPerSample !== bitsPerSample)) throw new Error('TTS_FRAGMENT_FORMAT_MISMATCH');
  const blockAlign = channels * (bitsPerSample / 8);
  const gap = Buffer.alloc(Math.round((sampleRate * gapMs) / 1000) * blockAlign);
  const parts: Buffer[] = [];
  chunks.forEach((chunk, index) => { if (index) parts.push(gap); parts.push(chunk.data); });
  return wavFromPcm(sampleRate, channels, bitsPerSample, Buffer.concat(parts));
}
