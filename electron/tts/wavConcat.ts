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

/**
 * Appends PCM WAV files to one growing WAV on disk with a chosen silence before each part, so a
 * thirty-minute podcast is never held in memory as one buffer. The header is written last,
 * once the data length is known; `append` reports where each part starts, so callers can keep
 * a timeline of turns and chapters.
 */
export class WavFileAssembler {
  private format: Omit<PcmChunk, 'data'> | null = null;
  private dataBytes = 0;
  private handle: import('node:fs/promises').FileHandle | null = null;

  constructor(private readonly file: string) {}

  get durationS(): number {
    if (!this.format) return 0;
    const blockAlign = this.format.channels * (this.format.bitsPerSample / 8);
    return this.dataBytes / blockAlign / this.format.sampleRate;
  }

  get sampleRate(): number | null { return this.format?.sampleRate ?? null; }

  private async open(): Promise<import('node:fs/promises').FileHandle> {
    if (!this.handle) {
      this.handle = await fs.open(this.file, 'w');
      await this.handle.write(Buffer.alloc(44), 0, 44, 0);
    }
    return this.handle;
  }

  /** Appends `paths` as one part (joined with `innerGapMs`), preceded by `gapBeforeMs` of silence. Returns where the part starts and its length. */
  async append(paths: readonly string[], gapBeforeMs: number, innerGapMs = CLIP_FRAGMENT_GAP_MS): Promise<{ startS: number; durationS: number }> {
    if (!paths.length) throw new Error('TTS_NO_FRAGMENTS');
    const handle = await this.open();
    const chunks = await Promise.all(paths.map(async (file) => pcmChunk(await fs.readFile(file))));
    this.format ??= { sampleRate: chunks[0].sampleRate, channels: chunks[0].channels, bitsPerSample: chunks[0].bitsPerSample };
    const { sampleRate, channels, bitsPerSample } = this.format;
    if (chunks.some((chunk) => chunk.sampleRate !== sampleRate || chunk.channels !== channels || chunk.bitsPerSample !== bitsPerSample)) throw new Error('TTS_FRAGMENT_FORMAT_MISMATCH');
    const blockAlign = channels * (bitsPerSample / 8);
    const silence = (ms: number) => Buffer.alloc(Math.round((sampleRate * Math.max(0, ms)) / 1000) * blockAlign);
    const parts: Buffer[] = [];
    if (this.dataBytes > 0) parts.push(silence(gapBeforeMs));
    const lead = parts.reduce((sum, part) => sum + part.length, 0);
    chunks.forEach((chunk, index) => { if (index) parts.push(silence(innerGapMs)); parts.push(chunk.data); });
    const body = Buffer.concat(parts);
    await handle.write(body, 0, body.length, 44 + this.dataBytes);
    const startS = (this.dataBytes + lead) / blockAlign / sampleRate;
    this.dataBytes += body.length;
    return { startS, durationS: (body.length - lead) / blockAlign / sampleRate };
  }

  /** Writes the header and closes the file. A file with no parts is removed. */
  async finish(): Promise<{ durationS: number; sampleRate: number } | null> {
    const handle = this.handle;
    this.handle = null;
    if (!handle || !this.format) { await handle?.close(); await fs.rm(this.file, { force: true }); return null; }
    const header = wavFromPcm(this.format.sampleRate, this.format.channels, this.format.bitsPerSample, Buffer.alloc(0));
    header.writeUInt32LE(36 + this.dataBytes, 4);
    header.writeUInt32LE(this.dataBytes, 40);
    await handle.write(header, 0, 44, 0);
    await handle.close();
    return { durationS: this.durationS, sampleRate: this.format.sampleRate };
  }

  async abort(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    await handle?.close().catch(() => {});
    await fs.rm(this.file, { force: true });
  }
}
