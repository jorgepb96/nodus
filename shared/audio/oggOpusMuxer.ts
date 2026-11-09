// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A minimal Ogg Opus (.opus) writer (RFC 7845) for one mono or stereo stream: the fallback
 * container where the platform has no AAC encoder (Linux). Chromium, Firefox, Android and
 * recent Safari play it. Granule positions count 48 kHz samples, as the format requires,
 * whatever rate the encoder was fed.
 */

export interface OggOpusInput {
  packets: Uint8Array[];
  /** Duration of each packet in microseconds (WebCodecs `EncodedAudioChunk.duration`). */
  durationsUs: number[];
  channels: number;
  /** The rate the audio had before encoding (informational, stored in OpusHead). */
  inputSampleRate: number;
  /** Encoder delay in 48 kHz samples. libopus uses 312 by default. */
  preSkip?: number;
  vendor?: string;
  title?: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24;
    for (let j = 0; j < 8; j += 1) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

export function oggCrc32(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function page(packets: Uint8Array[], granule: bigint, serial: number, sequence: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const packet of packets) {
    let left = packet.length;
    while (left >= 255) { lacing.push(255); left -= 255; }
    lacing.push(left);
  }
  const header = new Uint8Array(27 + lacing.length);
  const view = new DataView(header.buffer);
  header.set([0x4f, 0x67, 0x67, 0x53]); // OggS
  header[4] = 0;
  header[5] = flags;
  view.setBigInt64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  view.setUint32(22, 0, true);
  header[26] = lacing.length;
  header.set(lacing, 27);
  const out = concat([header, ...packets]);
  new DataView(out.buffer).setUint32(22, oggCrc32(out), true);
  return out;
}

function opusHead(channels: number, preSkip: number, inputRate: number): Uint8Array {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode('OpusHead'));
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputRate, true);
  view.setInt16(16, 0, true);
  head[18] = 0;
  return head;
}

function opusTags(vendor: string, title?: string): Uint8Array {
  const text = new TextEncoder();
  const vendorBytes = text.encode(vendor);
  const comments = title ? [text.encode(`TITLE=${title}`)] : [];
  const parts: Uint8Array[] = [text.encode('OpusTags')];
  const u32 = (value: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out; };
  parts.push(u32(vendorBytes.length), vendorBytes, u32(comments.length));
  for (const comment of comments) parts.push(u32(comment.length), comment);
  return concat(parts);
}

/** Packets per audio page: a page holds at most 255 lacing values. */
const PACKETS_PER_PAGE = 50;

export function muxOpusToOgg(input: OggOpusInput): Uint8Array {
  const serial = 0x4e6f6475; // "Nodu"
  const preSkip = input.preSkip ?? 312;
  const pages: Uint8Array[] = [
    page([opusHead(input.channels, preSkip, input.inputSampleRate)], 0n, serial, 0, 0x02),
    page([opusTags(input.vendor ?? 'Nodus', input.title)], 0n, serial, 1, 0),
  ];
  let granule = BigInt(preSkip);
  let sequence = 2;
  for (let start = 0; start < input.packets.length; start += PACKETS_PER_PAGE) {
    const batch = input.packets.slice(start, start + PACKETS_PER_PAGE);
    for (let index = start; index < start + batch.length; index += 1) {
      granule += BigInt(Math.round(((input.durationsUs[index] ?? 20_000) * 48_000) / 1_000_000));
    }
    const last = start + PACKETS_PER_PAGE >= input.packets.length;
    pages.push(page(batch, granule, serial, sequence, last ? 0x04 : 0));
    sequence += 1;
  }
  return concat(pages);
}
