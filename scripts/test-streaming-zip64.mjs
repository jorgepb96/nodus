// Backup archives past 4 GiB. The writer's 32-bit size and offset fields used to wrap silently, so a
// vault database larger than 4 GiB produced an entry whose recorded size disagreed with its data:
// verification refused every such backup and a pre-restore safety archive could never be restored.
// The writer must switch to ZIP64 fields for what does not fit, and the reader must read them.
//
// The ZIP32 limit is lowered here so the ZIP64 layout is exercised with a few kilobytes; Python's
// zipfile reads the result as an independent check. NODUS_ZIP64_REAL=1 also writes and reads back
// a real 4.1 GiB entry (sparse source, about 8 GiB of temporary disk).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-streaming-zip64-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
try {
  const { StreamingZipWriter } = require(path.join(repoRoot, 'electron/export/streamingZip.ts'));
  const { ZipFileReader, readZipEntrySync } = require(path.join(repoRoot, 'electron/export/zipFile.ts'));
  const sha = (data) => createHash('sha256').update(data).digest('hex');
  const readBack = async (file, name) => {
    const reader = await ZipFileReader.open(file);
    const entry = reader.entry(name);
    const target = path.join(scratch, `extract-${Math.random().toString(36).slice(2)}`);
    await reader.extract(entry, target);
    const data = fs.readFileSync(target);
    fs.rmSync(target, { force: true });
    return { entry, data };
  };
  const python = (file) => JSON.parse(execFileSync('python3', ['-I', '-c', `
import hashlib, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    bad = z.testzip()
    print(json.dumps({"bad": bad, "entries": {i.filename: [i.file_size, hashlib.sha256(z.read(i.filename)).hexdigest()] for i in z.infolist()}}))
`, file], { encoding: 'utf8' }));

  // 1. Ordinary archives are unchanged: ZIP32, readable by both readers and by Python.
  const small = randomBytes(5000);
  const plain = path.join(scratch, 'plain.zip');
  const plainWriter = new StreamingZipWriter(plain, 6);
  await plainWriter.addBuffer('manifest.json', Buffer.from('{"a":1}'), true);
  await plainWriter.addBuffer('data.bin', small);
  await plainWriter.finalize();
  assert.equal(fs.readFileSync(plain).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), false, 'no ZIP64 record when everything fits');
  assert.equal(sha((await readBack(plain, 'data.bin')).data), sha(small));

  // 2. Past the limit: sizes and offsets that do not fit go through ZIP64.
  StreamingZipWriter.zip32Limit = 4096;
  const big = randomBytes(9000);
  const source = path.join(scratch, 'big.bin');
  fs.writeFileSync(source, big);
  const archive = path.join(scratch, 'zip64.zip');
  const writer = new StreamingZipWriter(archive, 6);
  await writer.addBuffer('manifest.json', Buffer.from('{"vaults":1}'), true);
  await writer.addFile('vaults/a/database.sqlite', source, true);      // stored: both sizes past the limit
  await writer.addFile('vaults/b/database.sqlite', source);            // deflated, past the limit, offset past it
  await writer.addBuffer('after.json', Buffer.from('{"after":true}'));  // small, but its offset is past the limit
  await writer.finalize();
  StreamingZipWriter.zip32Limit = 0xffffffff;

  assert.ok(fs.readFileSync(archive).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'the archive carries a ZIP64 end record');
  const reader = await ZipFileReader.open(archive);
  assert.deepEqual(reader.entries.map((entry) => entry.name), ['manifest.json', 'vaults/a/database.sqlite', 'vaults/b/database.sqlite', 'after.json']);
  assert.equal(reader.entry('vaults/a/database.sqlite').uncompressedSize, big.byteLength, 'the real size is read from the ZIP64 field');
  assert.ok(reader.entry('after.json').localHeaderOffset > 4096, 'the real offset is read from the ZIP64 field');
  for (const name of ['vaults/a/database.sqlite', 'vaults/b/database.sqlite']) {
    assert.equal(sha((await readBack(archive, name)).data), sha(big), `${name} reads back`);
  }
  assert.equal((await readBack(archive, 'after.json')).data.toString(), '{"after":true}');
  assert.equal(readZipEntrySync(archive, 'manifest.json').toString(), '{"vaults":1}', 'the synchronous reader follows the ZIP64 directory too');
  assert.equal(readZipEntrySync(archive, 'after.json').toString(), '{"after":true}');

  const independent = python(archive);
  assert.equal(independent.bad, null, 'Python zipfile finds every CRC correct');
  assert.deepEqual(independent.entries['vaults/a/database.sqlite'], [big.byteLength, sha(big)]);
  assert.deepEqual(independent.entries['vaults/b/database.sqlite'], [big.byteLength, sha(big)]);
  assert.deepEqual(independent.entries['after.json'][0], 14);

  // 3. The real thing, when asked for: one entry larger than 4 GiB.
  if (process.env.NODUS_ZIP64_REAL === '1') {
    const sparse = path.join(scratch, 'sparse.bin');
    const size = 4 * 1024 ** 3 + 123_457;
    const fd = fs.openSync(sparse, 'w');
    fs.writeSync(fd, Buffer.from('head'), 0, 4, 0);
    fs.writeSync(fd, Buffer.from('tail'), 0, 4, size - 4);
    fs.closeSync(fd);
    const huge = path.join(scratch, 'huge.zip');
    const started = performance.now();
    const hugeWriter = new StreamingZipWriter(huge, 0);
    await hugeWriter.addBuffer('manifest.json', Buffer.from('{}'), true);
    await hugeWriter.addFile('backup.bin', sparse, true);
    await hugeWriter.addBuffer('recovery-key.bin', Buffer.from('key'), true);
    await hugeWriter.finalize();
    const written = performance.now() - started;
    const hugeReader = await ZipFileReader.open(huge);
    assert.equal(hugeReader.entry('backup.bin').uncompressedSize, size);
    assert.equal(readZipEntrySync(huge, 'recovery-key.bin').toString(), 'key');
    const out = path.join(scratch, 'huge.out');
    await hugeReader.extract(hugeReader.entry('backup.bin'), out);
    assert.equal(fs.statSync(out).size, size);
    const check = python(huge);
    assert.equal(check.bad, null);
    assert.equal(check.entries['backup.bin'][0], size);
    console.log(`Real ZIP64: ${(size / 1024 ** 3).toFixed(2)} GiB entry written in ${(written / 1000).toFixed(1)} s, read back and checked by Python.`);
  }
  console.log('StreamingZipWriter/ZipFileReader: ZIP32 when it fits, ZIP64 past the limit, both read back.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
