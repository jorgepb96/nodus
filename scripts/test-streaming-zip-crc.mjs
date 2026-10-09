// The backup ZIP writer's CRC-32 must come from zlib's native implementation, and must still be
// right. The JS byte loop it replaces ran at 186 MiB/s on the Electron main process: on a 2.8 GB
// vault and its 1.1 GB archive, ~21 s of event-loop time per backup.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-streaming-zip-crc-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const zlib = require('node:zlib');
try {
  assert.equal(typeof zlib.crc32, 'function', 'this runtime has a native crc32');
  const native = zlib.crc32;
  let nativeBytes = 0;
  zlib.crc32 = (data, value) => { nativeBytes += data.byteLength; return native(data, value); };
  const { StreamingZipWriter } = require(path.join(repoRoot, 'electron/export/streamingZip.ts'));
  const AdmZip = require('adm-zip');

  const big = randomBytes(3 * 1024 * 1024 + 17);
  const small = Buffer.from('hello, world\n');
  const sourceFile = path.join(scratch, 'source.bin');
  fs.writeFileSync(sourceFile, big);
  const target = path.join(scratch, 'out.zip');
  const writer = new StreamingZipWriter(target, 6);
  await writer.addFile('deflated.bin', sourceFile);
  await writer.addFile('stored.bin', sourceFile, true);
  await writer.addBuffer('small.txt', small, true);
  await writer.addBuffer('empty.txt', Buffer.alloc(0));
  await writer.finalize();

  assert.ok(nativeBytes >= big.byteLength * 2 + small.byteLength, `the CRC is computed natively (${nativeBytes} bytes through zlib.crc32)`);
  const zip = new AdmZip(target);
  const expected = { 'deflated.bin': big, 'stored.bin': big, 'small.txt': small, 'empty.txt': Buffer.alloc(0) };
  for (const [name, data] of Object.entries(expected)) {
    const entry = zip.getEntry(name);
    assert.ok(entry, name);
    assert.equal(entry.header.crc >>> 0, native(data), `${name}: the recorded CRC is the CRC of the data`);
    assert.ok(entry.getData().equals(data), `${name}: the data reads back`);
  }
  console.log('StreamingZipWriter: native CRC-32, and every entry reads back with a matching checksum.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
