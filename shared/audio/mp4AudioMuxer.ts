// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A minimal MP4 (.m4a) writer for ONE AAC-LC audio track, enough for every podcast player and
 * for Chromium's <audio>. No dependency: a podcast is a single track of fixed-size frames, so
 * the sample table is one chunk with one duration. `moov` is written before `mdat`
 * ("fast start"), so playback can begin before the whole file is read. Chapter titles go in a
 * Nero `chpl` box, which Apple Podcasts, Overcast, VLC and most players read.
 */

export interface Mp4AudioInput {
  /** AudioSpecificConfig from the encoder (WebCodecs `decoderConfig.description`). */
  audioSpecificConfig: Uint8Array;
  sampleRate: number;
  channels: number;
  /** Raw AAC frames, in order. */
  frames: Uint8Array[];
  /** Samples per frame (1024 for AAC-LC). */
  frameSamples?: number;
  bitrate?: number;
  chapters?: Array<{ startS: number; title: string }>;
  title?: string;
}

const encoder = new TextEncoder();

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value & 0xffff);
  return out;
}

function u64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, Math.floor(value / 2 ** 32));
  view.setUint32(4, value >>> 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u32(8 + body.length), encoder.encode(type), body]);
}

function fullBox(type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array {
  return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...payload);
}

const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

/** An MPEG-4 descriptor: tag, size as four 7-bit groups, body. */
function descriptor(tag: number, body: Uint8Array): Uint8Array {
  const size = body.length;
  return concat([new Uint8Array([tag, 0x80 | ((size >> 21) & 0x7f), 0x80 | ((size >> 14) & 0x7f), 0x80 | ((size >> 7) & 0x7f), size & 0x7f]), body]);
}

function esds(asc: Uint8Array, bitrate: number, maxFrame: number): Uint8Array {
  const decoderSpecific = descriptor(0x05, asc);
  const decoderConfig = descriptor(0x04, concat([
    new Uint8Array([0x40, 0x15]), // MPEG-4 audio; audio stream
    new Uint8Array([(maxFrame >> 16) & 0xff, (maxFrame >> 8) & 0xff, maxFrame & 0xff]),
    u32(bitrate), u32(bitrate),
    decoderSpecific,
  ]));
  const sl = descriptor(0x06, new Uint8Array([0x02]));
  const es = descriptor(0x03, concat([u16(1), new Uint8Array([0]), decoderConfig, sl]));
  return fullBox('esds', 0, 0, es);
}

function chpl(chapters: Array<{ startS: number; title: string }>): Uint8Array {
  const entries = chapters.slice(0, 255).map((chapter) => {
    const title = encoder.encode(chapter.title).slice(0, 255);
    // 100-nanosecond units.
    return concat([u64(Math.max(0, Math.round(chapter.startS * 10_000_000))), new Uint8Array([title.length]), title]);
  });
  return fullBox('chpl', 1, 0, u32(0), new Uint8Array([entries.length]), ...entries);
}

function udta(input: Mp4AudioInput): Uint8Array | null {
  const parts: Uint8Array[] = [];
  if (input.chapters?.length) parts.push(chpl(input.chapters));
  if (input.title) {
    const text = encoder.encode(input.title);
    // iTunes-style title atom (©nam) inside meta/ilst.
    const data = box('data', u32(1), u32(0), text);
    const nam = box('©nam', data);
    const hdlr = fullBox('hdlr', 0, 0, u32(0), encoder.encode('mdir'), encoder.encode('appl'), u32(0), u32(0), new Uint8Array([0]));
    parts.push(fullBox('meta', 0, 0, hdlr, box('ilst', nam)));
  }
  return parts.length ? box('udta', ...parts) : null;
}

export function muxAacToMp4(input: Mp4AudioInput): Uint8Array {
  const frameSamples = input.frameSamples ?? 1024;
  const timescale = input.sampleRate;
  const count = input.frames.length;
  const duration = count * frameSamples;
  const maxFrame = input.frames.reduce((max, frame) => Math.max(max, frame.length), 0);
  const dataBytes = input.frames.reduce((sum, frame) => sum + frame.length, 0);
  const bitrate = input.bitrate ?? (duration ? Math.round((dataBytes * 8 * timescale) / duration) : 0);

  const mp4a = box('mp4a',
    new Uint8Array(6), u16(1), // reserved, data reference index
    u32(0), u32(0), // reserved
    u16(input.channels), u16(16), u16(0), u16(0),
    u32((input.sampleRate & 0xffff) * 65536 >>> 0),
    esds(input.audioSpecificConfig, bitrate, maxFrame),
  );
  const stsd = fullBox('stsd', 0, 0, u32(1), mp4a);
  const stts = fullBox('stts', 0, 0, u32(count ? 1 : 0), ...(count ? [u32(count), u32(frameSamples)] : []));
  const stsc = fullBox('stsc', 0, 0, u32(count ? 1 : 0), ...(count ? [u32(1), u32(count), u32(1)] : []));
  // One buffer for the size table: a 30-minute episode has ~84,000 frames, far more
  // than a function call can take as separate arguments.
  const sizes = new Uint8Array(count * 4);
  const sizesView = new DataView(sizes.buffer);
  input.frames.forEach((frame, i) => sizesView.setUint32(i * 4, frame.length));
  const stsz = fullBox('stsz', 0, 0, u32(0), u32(count), sizes);

  const build = (chunkOffset: number) => {
    const stco = fullBox('stco', 0, 0, u32(count ? 1 : 0), ...(count ? [u32(chunkOffset)] : []));
    const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
    const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
    const minf = box('minf', fullBox('smhd', 0, 0, u16(0), u16(0)), dinf, stbl);
    const hdlr = fullBox('hdlr', 0, 0, u32(0), encoder.encode('soun'), u32(0), u32(0), u32(0), encoder.encode('SoundHandler\0'));
    const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)); // language: und
    const mdia = box('mdia', mdhd, hdlr, minf);
    const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(duration), u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0), MATRIX, u32(0), u32(0));
    const trak = box('trak', tkhd, mdia);
    const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), new Uint8Array(10), MATRIX, new Uint8Array(24), u32(2));
    const extra = udta(input);
    return box('moov', mvhd, trak, ...(extra ? [extra] : []));
  };

  const ftyp = box('ftyp', encoder.encode('M4A '), u32(0), encoder.encode('M4A '), encoder.encode('isom'), encoder.encode('mp42'));
  // moov's size does not depend on the offset's value, so build it once to measure.
  const moovSize = build(0).length;
  const moov = build(ftyp.length + moovSize + 8);
  const mdatHeader = concat([u32(8 + dataBytes), encoder.encode('mdat')]);
  return concat([ftyp, moov, mdatHeader, ...input.frames]);
}

/** Reads the top-level boxes of an MP4 (for tests and sanity checks). */
export function mp4Boxes(bytes: Uint8Array, start = 0, end = bytes.length): Array<{ type: string; start: number; size: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Array<{ type: string; start: number; size: number }> = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = view.getUint32(offset);
    const type = new TextDecoder('latin1').decode(bytes.subarray(offset + 4, offset + 8));
    if (size < 8 || offset + size > end) break;
    out.push({ type, start: offset, size });
    offset += size;
  }
  return out;
}
