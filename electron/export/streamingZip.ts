import fs from 'node:fs';
import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  CRC_TABLE[n] = value >>> 0;
}

function updateCrcInJs(crc: number, data: Buffer): number {
  let next = crc;
  for (const byte of data) next = CRC_TABLE[(next ^ byte) & 0xff] ^ (next >>> 8);
  return next >>> 0;
}

/**
 * The running CRC-32 of an entry, in the pre/post-conditioned form ZIP writers keep (start at
 * 0xffffffff, xor at the end). The byte loop above ran at 186 MiB/s on the main process: a 2.8 GB
 * vault plus its 1.1 GB encrypted archive spent ~21 s of event-loop time in it on every backup.
 * zlib's native crc32 (Node 22.2+, Electron's runtime) does the same 512 MiB in 22 ms.
 */
const nativeCrc32 = (zlib as { crc32?: (data: Buffer, value?: number) => number }).crc32;
function updateCrc(crc: number, data: Buffer): number {
  // zlib.crc32 takes and returns the finished value, so undo and redo the conditioning around it.
  if (nativeCrc32) return (nativeCrc32(data, (crc ^ 0xffffffff) >>> 0) ^ 0xffffffff) >>> 0;
  return updateCrcInJs(crc, data);
}

function u16(value: number): Buffer { const out = Buffer.allocUnsafe(2); out.writeUInt16LE(value, 0); return out; }
function u32(value: number): Buffer {
  // Never wrap: a size or offset past 4 GiB must go through the ZIP64 fields, not lose its top bits.
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(`ZIP field out of range: ${value}`);
  const out = Buffer.allocUnsafe(4); out.writeUInt32LE(value, 0); return out;
}
function u64(value: number): Buffer { const out = Buffer.allocUnsafe(8); out.writeBigUInt64LE(BigInt(value), 0); return out; }

interface CentralEntry {
  name: Buffer;
  zip64: boolean;
  method: 0 | 8;
  crc: number;
  compressed: number;
  uncompressed: number;
  offset: number;
}

/** Minimal sequential ZIP writer with data descriptors. It invokes
 * `zlib.createDeflateRaw` explicitly, so tests can prove compression is asynchronous.
 *
 * ZIP32 while everything fits, ZIP64 for whatever does not. The 32-bit size fields used to wrap
 * silently, so a vault database past 4 GiB produced an archive whose recorded size disagreed with
 * its data: every backup then failed verification and was discarded, and a pre-restore safety
 * archive (which is not verified) could not have been restored. */
export class StreamingZipWriter {
  /** The largest value a ZIP32 field may hold; anything at or past it goes into ZIP64 fields. Tests
   *  lower it to exercise the ZIP64 layout without writing 4 GiB. */
  static zip32Limit = 0xffffffff;

  private readonly output: fs.WriteStream;
  private readonly entries: CentralEntry[] = [];
  private offset = 0;
  private closed = false;

  constructor(private readonly target: string, private readonly level = 6) {
    this.output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
  }

  async addBuffer(name: string, data: Buffer, store = false): Promise<void> {
    await this.add(name, Readable.from([data]), store);
  }

  async addFile(name: string, source: string, store = false): Promise<void> {
    await this.add(name, fs.createReadStream(source), store);
  }

  private async write(data: Buffer): Promise<void> {
    this.offset += data.byteLength;
    if (!this.output.write(data)) await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => { this.output.off('drain', onDrain); this.output.off('error', onError); };
      const onDrain = (): void => { cleanup(); resolve(); };
      const onError = (error: Error): void => { cleanup(); reject(error); };
      this.output.once('drain', onDrain); this.output.once('error', onError);
    });
  }

  private async add(nameText: string, input: Readable, store: boolean): Promise<void> {
    if (this.closed) throw new Error('El ZIP ya está cerrado.');
    const name = Buffer.from(nameText.replace(/\\/g, '/'), 'utf8');
    const method: 0 | 8 = store ? 0 : 8;
    const offset = this.offset;
    const flags = 0x0808; // UTF-8 + trailing data descriptor
    await this.write(Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(0), u32(0), u32(0), u16(name.length), u16(0), name,
    ]));
    let crc = 0xffffffff;
    let uncompressed = 0;
    let compressed = 0;
    const source = store ? input : input.pipe(zlib.createDeflateRaw({ level: this.level }));
    if (store) {
      for await (const raw of source) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        crc = updateCrc(crc, chunk); uncompressed += chunk.byteLength; compressed += chunk.byteLength;
        await this.write(chunk);
      }
    } else {
      input.on('data', (raw: Buffer) => { const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); crc = updateCrc(crc, chunk); uncompressed += chunk.byteLength; });
      for await (const raw of source) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        compressed += chunk.byteLength;
        await this.write(chunk);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const limit = StreamingZipWriter.zip32Limit;
    const zip64 = compressed >= limit || uncompressed >= limit || offset >= limit;
    // A ZIP64 entry's data descriptor carries 8-byte sizes.
    await this.write(zip64
      ? Buffer.concat([u32(0x08074b50), u32(crc), u64(compressed), u64(uncompressed)])
      : Buffer.concat([u32(0x08074b50), u32(crc), u32(compressed), u32(uncompressed)]));
    this.entries.push({ name, zip64, method, crc, compressed, uncompressed, offset });
  }

  async finalize(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const limit = StreamingZipWriter.zip32Limit;
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      // Each value that does not fit is written as 0xffffffff and given, in this order, in the
      // ZIP64 extra field.
      const big: Buffer[] = [];
      if (entry.uncompressed >= limit) big.push(u64(entry.uncompressed));
      if (entry.compressed >= limit) big.push(u64(entry.compressed));
      if (entry.offset >= limit) big.push(u64(entry.offset));
      const extra = big.length ? Buffer.concat([u16(0x0001), u16(big.length * 8), ...big]) : Buffer.alloc(0);
      const version = entry.zip64 ? 45 : 20;
      await this.write(Buffer.concat([
        u32(0x02014b50), u16(version), u16(version), u16(0x0808), u16(entry.method), u16(0), u16(0),
        u32(entry.crc),
        u32(entry.compressed >= limit ? 0xffffffff : entry.compressed),
        u32(entry.uncompressed >= limit ? 0xffffffff : entry.uncompressed),
        u16(entry.name.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0),
        u32(entry.offset >= limit ? 0xffffffff : entry.offset),
        entry.name, extra,
      ]));
    }
    const centralSize = this.offset - centralOffset;
    const count = this.entries.length;
    const zip64 = count >= 0xffff || centralSize >= limit || centralOffset >= limit || this.entries.some((entry) => entry.zip64);
    if (zip64) {
      const recordOffset = this.offset;
      await this.write(Buffer.concat([
        u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
        u64(count), u64(count), u64(centralSize), u64(centralOffset),
      ]));
      await this.write(Buffer.concat([u32(0x07064b50), u32(0), u64(recordOffset), u32(1)]));
    }
    await this.write(Buffer.concat([
      u32(0x06054b50), u16(0), u16(0),
      u16(zip64 && count >= 0xffff ? 0xffff : count), u16(zip64 && count >= 0xffff ? 0xffff : count),
      u32(zip64 && centralSize >= limit ? 0xffffffff : centralSize),
      u32(zip64 && centralOffset >= limit ? 0xffffffff : centralOffset), u16(0),
    ]));
    await new Promise<void>((resolve, reject) => {
      this.output.once('close', resolve); this.output.once('error', reject); this.output.end();
    });
  }

  path(): string { return this.target; }
}
