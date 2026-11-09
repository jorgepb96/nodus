// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Compresses an assembled podcast WAV: a hidden, sandboxed window encodes with WebCodecs
 * (AAC where the platform has an encoder, Opus otherwise) and the main process muxes the
 * packets into .m4a or .opus. The window is created for one episode and destroyed after it.
 */
import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { muxAacToMp4 } from '@shared/audio/mp4AudioMuxer';
import { muxOpusToOgg } from '@shared/audio/oggOpusMuxer';
import { PODCAST_ENCODER_HTML } from './podcastEncoderPage';

export interface EncodedPodcast {
  file: string;
  mime: string;
  codec: string;
  bytes: number;
}

const CHUNK_BYTES = 1 << 20; // even, so no sample is split
const BITRATE = 64_000;

interface WavLayout { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataBytes: number }

async function readLayout(handle: fs.FileHandle): Promise<WavLayout> {
  const head = Buffer.alloc(4096);
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  if (bytesRead < 44 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error('PODCAST_BAD_WAV');
  let offset = 12;
  let format: Omit<WavLayout, 'dataOffset' | 'dataBytes'> | null = null;
  while (offset + 8 <= bytesRead) {
    const id = head.toString('ascii', offset, offset + 4);
    const size = head.readUInt32LE(offset + 4);
    if (id === 'fmt ') format = { channels: head.readUInt16LE(offset + 10), sampleRate: head.readUInt32LE(offset + 12), bitsPerSample: head.readUInt16LE(offset + 22) };
    else if (id === 'data' && format) return { ...format, dataOffset: offset + 8, dataBytes: size };
    offset += 8 + size + (size % 2);
  }
  throw new Error('PODCAST_BAD_WAV');
}

interface Drained { data: string; sizes: number[]; durations: number[] }

function split(drained: Drained, frames: Uint8Array[], durations: number[]): void {
  const bytes = Buffer.from(drained.data, 'base64');
  let offset = 0;
  drained.sizes.forEach((size, index) => {
    frames.push(new Uint8Array(bytes.subarray(offset, offset + size)));
    durations.push(drained.durations[index] ?? 0);
    offset += size;
  });
}

export async function encodePodcastWav(
  wavPath: string,
  outBase: string,
  meta: { title: string; chapters: Array<{ startS: number; title: string }> },
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<EncodedPodcast> {
  signal.throwIfAborted();
  const handle = await fs.open(wavPath, 'r');
  const pageDir = path.join(path.dirname(wavPath), `encoder-${randomUUID()}`);
  let win: BrowserWindow | null = null;
  try {
    const layout = await readLayout(handle);
    if (layout.bitsPerSample !== 16) throw new Error('PODCAST_BAD_WAV');
    await fs.mkdir(pageDir, { recursive: true });
    const page = path.join(pageDir, 'encoder.html');
    await fs.writeFile(page, PODCAST_ENCODER_HTML);
    win = new BrowserWindow({
      show: false, focusable: false, skipTaskbar: true, width: 200, height: 200,
      webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        backgroundThrottling: false, devTools: false, partition: `podcast-encoder-${randomUUID()}`,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    await win.loadFile(page);
    const run = <T>(script: string) => {
      signal.throwIfAborted();
      if (!win || win.isDestroyed()) throw new Error('PODCAST_ENCODER_GONE');
      return win.webContents.executeJavaScript(script) as Promise<T>;
    };
    const started = await run<{ codec: 'aac' | 'opus'; outRate: number }>(`window.podcastEncoder.init(${layout.sampleRate}, ${layout.channels}, ${BITRATE})`);
    const frames: Uint8Array[] = [];
    const durations: number[] = [];
    const chunk = Buffer.alloc(CHUNK_BYTES);
    for (let read = 0; read < layout.dataBytes;) {
      const want = Math.min(CHUNK_BYTES, layout.dataBytes - read);
      const { bytesRead } = await handle.read(chunk, 0, want, layout.dataOffset + read);
      if (!bytesRead) break;
      const even = bytesRead - (bytesRead % 2);
      split(await run<Drained>(`window.podcastEncoder.push(${JSON.stringify(chunk.subarray(0, even).toString('base64'))})`), frames, durations);
      read += bytesRead;
      onProgress?.(Math.min(1, read / layout.dataBytes));
    }
    const finished = await run<Drained & { description: string; codec: string; outRate: number }>('window.podcastEncoder.finish()');
    split(finished, frames, durations);
    if (!frames.length) throw new Error('PODCAST_ENCODER_EMPTY');
    let bytes: Uint8Array;
    let file: string;
    let mime: string;
    let codec: string;
    if (started.codec === 'aac') {
      const asc = finished.description ? Buffer.from(finished.description, 'base64') : null;
      if (!asc?.length) throw new Error('PODCAST_ENCODER_NO_CONFIG');
      bytes = muxAacToMp4({ audioSpecificConfig: new Uint8Array(asc), sampleRate: started.outRate, channels: 1, frames, bitrate: BITRATE, chapters: meta.chapters, title: meta.title });
      file = `${outBase}.m4a`;
      mime = 'audio/mp4';
      codec = 'mp4a.40.2';
    } else {
      bytes = muxOpusToOgg({ packets: frames, durationsUs: durations, channels: 1, inputSampleRate: layout.sampleRate, title: meta.title });
      file = `${outBase}.opus`;
      mime = 'audio/ogg';
      codec = 'opus';
    }
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, bytes);
    await fs.rename(temp, file);
    return { file, mime, codec, bytes: bytes.length };
  } finally {
    await handle.close().catch(() => {});
    if (win && !win.isDestroyed()) win.destroy();
    await fs.rm(pageDir, { recursive: true, force: true }).catch(() => {});
  }
}
