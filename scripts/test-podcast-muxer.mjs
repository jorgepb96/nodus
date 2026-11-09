// The podcast's dependency-free containers: an AAC track in MP4 (fast start, one chunk,
// chapters in `chpl`) and Opus in Ogg (CRC-checked pages, 48 kHz granules). Real encoding
// is exercised in the live end-to-end check; here the structure is verified byte by byte.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-podcast-muxer-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const entry = path.join(tmp, 'entry.ts');
await writeFile(entry, [
  `export * from ${JSON.stringify(path.join(repoRoot, 'shared/audio/mp4AudioMuxer.ts'))};`,
  `export * from ${JSON.stringify(path.join(repoRoot, 'shared/audio/oggOpusMuxer.ts'))};`,
  `export * from ${JSON.stringify(path.join(repoRoot, 'shared/audio/wavEncode.ts'))};`,
].join('\n'));
const outfile = path.join(tmp, 'mux.mjs');
await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const m = await import(pathToFileURL(outfile).href);

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function find(bytes, type, start = 0, end = bytes.length) {
  for (const entry of m.mp4Boxes(bytes, start, end)) if (entry.type === type) return entry;
  return null;
}
function path_(bytes, types) {
  let range = { start: 0, size: bytes.length, header: 0 };
  for (const type of types) {
    const inner = range.start + (range.header ?? 8);
    const found = find(bytes, type, inner, range.start + range.size);
    assert.ok(found, `box ${types.join('/')} reaches ${type}`);
    range = { ...found, header: 8 };
  }
  return range;
}

test('an AAC track muxes into a fast-start MP4 whose sample table points at the data', () => {
  const frames = Array.from({ length: 100 }, (_, i) => new Uint8Array(50 + (i % 7)).fill(i));
  const bytes = m.muxAacToMp4({ audioSpecificConfig: new Uint8Array([0x11, 0x88]), sampleRate: 48000, channels: 1, frames, chapters: [{ startS: 0, title: 'Uno' }, { startS: 1.5, title: 'Dos' }], title: 'Episodio' });
  assert.deepEqual(m.mp4Boxes(bytes).map((b) => b.type), ['ftyp', 'moov', 'mdat'], 'moov before mdat');
  const mvhd = path_(bytes, ['moov', 'mvhd']);
  assert.equal(view(bytes).getUint32(mvhd.start + 20), 48000, 'timescale is the sample rate');
  assert.equal(view(bytes).getUint32(mvhd.start + 24), 100 * 1024, 'duration in samples');
  const stbl = path_(bytes, ['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const stco = find(bytes, 'stco', stbl.start + 8, stbl.start + stbl.size);
  const offset = view(bytes).getUint32(stco.start + 16);
  const mdat = find(bytes, 'mdat');
  assert.equal(offset, mdat.start + 8, 'the chunk offset is the first frame');
  assert.deepEqual([...bytes.subarray(offset, offset + 3)], [0, 0, 0]);
  const stsz = find(bytes, 'stsz', stbl.start + 8, stbl.start + stbl.size);
  assert.equal(view(bytes).getUint32(stsz.start + 16), 100);
  assert.equal(view(bytes).getUint32(stsz.start + 20), 50);
  const total = frames.reduce((s, f) => s + f.length, 0);
  assert.equal(mdat.size, total + 8);
  const stsd = find(bytes, 'stsd', stbl.start + 8, stbl.start + stbl.size);
  const text = Buffer.from(bytes.subarray(stsd.start, stsd.start + stsd.size)).toString('latin1');
  assert.ok(text.includes('mp4a') && text.includes('esds'));
  assert.ok(Buffer.from(bytes).includes(Buffer.from([0x05, 0x80, 0x80, 0x80, 0x02, 0x11, 0x88])), 'AudioSpecificConfig travels in esds');
  const udta = path_(bytes, ['moov', 'udta']);
  const chpl = find(bytes, 'chpl', udta.start + 8, udta.start + udta.size);
  assert.equal(bytes[chpl.start + 16], 2, 'two chapters');
  assert.ok(Buffer.from(bytes).includes(Buffer.from('Episodio')));
});

test('a 30-minute episode muxes without overflowing the call stack', () => {
  // 30 min of AAC at 48 kHz is ~84,400 frames of 1024 samples; Opus at 20 ms is 90,000
  // packets. One function argument per frame used to blow the stack ("Maximum call stack
  // size exceeded") on the longest episodes.
  const aacFrames = Array.from({ length: Math.ceil((30 * 60 * 48000) / 1024) }, (_, i) => new Uint8Array(8).fill(i & 0xff));
  const mp4 = m.muxAacToMp4({ audioSpecificConfig: new Uint8Array([0x11, 0x88]), sampleRate: 48000, channels: 1, frames: aacFrames });
  const stbl = path_(mp4, ['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const stsz = find(mp4, 'stsz', stbl.start + 8, stbl.start + stbl.size);
  assert.equal(view(mp4).getUint32(stsz.start + 16), aacFrames.length, 'every frame has a size entry');
  assert.equal(stsz.size, 20 + aacFrames.length * 4);
  assert.equal(find(mp4, 'mdat').size, aacFrames.length * 8 + 8);

  const packets = Array.from({ length: 90_000 }, (_, i) => new Uint8Array(6).fill(i & 0xff));
  const ogg = m.muxOpusToOgg({ packets, durationsUs: packets.map(() => 20_000), channels: 1, inputSampleRate: 24000 });
  assert.ok(ogg.length > packets.length * 6);
});

test('Opus packets mux into Ogg pages with valid CRCs and 48 kHz granules', () => {
  const packets = Array.from({ length: 120 }, (_, i) => new Uint8Array(40 + (i % 5)).fill(i));
  const bytes = m.muxOpusToOgg({ packets, durationsUs: packets.map(() => 20_000), channels: 1, inputSampleRate: 24000, title: 'Episodio' });
  const pages = [];
  for (let offset = 0; offset < bytes.length;) {
    assert.equal(Buffer.from(bytes.subarray(offset, offset + 4)).toString('latin1'), 'OggS');
    const segments = bytes[offset + 26];
    const lacing = bytes.subarray(offset + 27, offset + 27 + segments);
    const size = 27 + segments + lacing.reduce((a, b) => a + b, 0);
    const pageBytes = new Uint8Array(bytes.subarray(offset, offset + size));
    const crc = view(pageBytes).getUint32(22, true);
    view(pageBytes).setUint32(22, 0, true);
    assert.equal(m.oggCrc32(pageBytes), crc, 'page CRC');
    pages.push({ flags: bytes[offset + 5], granule: view(bytes).getBigInt64(offset + 6, true), seq: view(bytes).getUint32(offset + 18, true), first: Buffer.from(bytes.subarray(offset + 27 + segments, offset + 27 + segments + 8)).toString('latin1') });
    offset += size;
  }
  assert.equal(pages[0].first, 'OpusHead');
  assert.equal(pages[0].flags, 0x02, 'beginning of stream');
  assert.equal(pages[1].first, 'OpusTags');
  assert.equal(pages.length, 2 + 3, '120 packets in pages of 50');
  assert.deepEqual(pages.map((p) => p.seq), [0, 1, 2, 3, 4]);
  assert.equal(pages.at(-1).flags, 0x04, 'end of stream');
  assert.equal(pages.at(-1).granule, 312n + 120n * 960n);
  assert.equal(m.oggCrc32(new TextEncoder().encode('123456789')), 0x89a1897f, 'Ogg CRC-32 check value');
});

test('the WAV download is mono PCM16 with clipped samples', () => {
  const wav = m.wavFromFloat32(new Float32Array([0, 1, -1, 2, -2, 0.5]), 24000);
  const v = new DataView(wav.buffer);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString('latin1'), 'RIFF');
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(40, true), 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768, 16384]);
});
