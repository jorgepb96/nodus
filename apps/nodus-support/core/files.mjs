// This module never removes a file. Sources are opened for reading only, including SQLite WAL.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
// Electron virtualizes ASAR files and supplies synthetic inode/mtime values.
// Inventories and byte hashes must read physical files, including whole ASARs.
// Every write also enforces the explicit copied-profile boundary below.
export const physicalFs=process.versions.electron?createRequire(import.meta.url)('original-fs'):fs;
const physicalFsp=physicalFs.promises;

export class SupportError extends Error {
  constructor(code, detail = '') { super(code); this.name = 'SupportError'; this.code = code; this.detail = detail; }
}
export function assert(condition, code) { if (!condition) throw new SupportError(code); }
export function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function canonical(input) {
  assert(typeof input === 'string' && path.isAbsolute(input), 'INVALID_PATH');
  let at = path.resolve(input); const tail = [];
  while (!physicalFs.existsSync(at)) { const parent = path.dirname(at); assert(parent !== at, 'INVALID_PATH'); tail.unshift(path.basename(at)); at = parent; }
  // Use the same public path representation as Electron and isolation markers.
  // Windows native realpath can add a device namespace to only one side.
  return path.join(physicalFs.realpathSync(at), ...tail);
}
export function noLinks(input) {
  let at = path.resolve(input);
  for (;;) {
    try { assert(!physicalFs.lstatSync(at).isSymbolicLink(), 'LINK_NOT_SUPPORTED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(at); if (parent === at) break; at = parent;
  }
}
export function separate(a, b) { const left = canonical(a); const right = canonical(b); assert(!inside(left, right) && !inside(right, left), 'OVERLAPPING_STORAGE'); }
export function destination(root, relative) {
  assert(typeof relative === 'string' && !path.isAbsolute(relative) && !relative.includes('\0'), 'INVALID_PATH');
  const target = path.resolve(root, relative); assert(inside(root, target) && target !== root, 'PATH_ESCAPE'); noLinks(target); return target;
}
export function assertWritablePath(file) {
  const root=process.env.NODUS_ISOLATED_ROOT;if(!root)return;
  noLinks(file);const boundary=canonical(root),target=canonical(file);
  assert(inside(boundary,target),'SUPPORT_WRITE_DENIED');
  let at=path.resolve(file);
  while(inside(boundary,at)) {
    try{const stat=physicalFs.lstatSync(at);assert(!stat.isFile()||stat.nlink===1,'SUPPORT_WRITE_DENIED');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(at===boundary)break;at=path.dirname(at);
  }
}
export function readJson(file, fallback = null) {
  try { assert(physicalFs.statSync(file).size <= 32 * 1024 * 1024, 'JSON_TOO_LARGE'); return JSON.parse(physicalFs.readFileSync(file, 'utf8')); }
  catch (error) { if (fallback !== null) return fallback; throw error; }
}
export async function writeNew(file, content) {
  assertWritablePath(file);noLinks(file); await physicalFsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = await physicalFsp.open(file, 'wx', 0o600);
  try { await fd.writeFile(typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2)); await fd.sync(); }
  finally { await fd.close(); }
  await syncDirectory(path.dirname(file));
}
async function syncDirectory(folder) {
  // Directory fsync makes the name durable on POSIX; Windows does not expose it.
  if (process.platform === 'win32') return;
  const fd = await physicalFsp.open(folder, 'r'); try { await fd.sync(); } finally { await fd.close(); }
}
export async function writeRecord(file, content) {
  assertWritablePath(file);
  // A power loss can leave an incomplete prepared record, never a truncated journal entry.
  const prepared = path.join(path.dirname(file), 'prepared', `${randomUUID()}.json`);
  await writeNew(prepared, content);
  noLinks(file); await physicalFsp.link(prepared, file); await syncDirectory(path.dirname(file));
}
export async function hashFile(file, signal) {
  signal?.throwIfAborted(); const hash = createHash('sha256');
  for await (const chunk of physicalFs.createReadStream(file, { highWaterMark: 1024 * 1024, signal })) hash.update(chunk);
  return hash.digest('hex');
}
export async function inventory(root, signal, progress = () => {}, { links = false } = {}) {
  noLinks(root); const entries = []; let bytes = 0;
  async function walk(at, relative) {
    signal?.throwIfAborted(); const stat = await physicalFsp.lstat(at);
    if (stat.isSymbolicLink()) {
      assert(links, 'LINK_NOT_SUPPORTED'); const target = await physicalFsp.readlink(at);
      assert(!path.isAbsolute(target) && inside(root, path.resolve(path.dirname(at), target)), 'LINK_NOT_SUPPORTED');
      entries.push({ path: relative, type: 'link', target }); return;
    }
    if (stat.isDirectory()) {
      entries.push({ path: relative, type: 'directory', mode: stat.mode & 0o777 });
      for (const name of (await physicalFsp.readdir(at)).sort()) await walk(path.join(at, name), relative ? `${relative}/${name}` : name);
    } else {
      assert(stat.isFile(), 'SPECIAL_FILE_NOT_SUPPORTED');
      const sha256 = await hashFile(at, signal); const after = await physicalFsp.lstat(at);
      assert(stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ino === after.ino, 'SOURCE_CHANGED');
      entries.push({ path: relative, type: 'file', bytes: stat.size, mode: stat.mode & 0o777, sha256 }); bytes += stat.size;
      progress({ phase: 'inventory', completed: bytes, total: 0 });
    }
  }
  await walk(root, ''); return { entries, bytes };
}
export async function copyInventory(source, target, manifest, signal, progress = () => {}) {
  assertWritablePath(target);
  separate(source, target); noLinks(source); noLinks(target);
  assert(!fs.existsSync(target), 'DESTINATION_EXISTS'); let completed = 0; const links = [];
  for (const entry of manifest.entries) {
    signal?.throwIfAborted();
    const from = entry.type === 'link' ? path.resolve(source,entry.path) : entry.path ? destination(source, entry.path) : source;
    assert(inside(source,from), 'PATH_ESCAPE');
    if (entry.type === 'link') noLinks(path.dirname(from));
    const to = entry.path ? destination(target, entry.path) : target;
    if (entry.type === 'directory') { await physicalFsp.mkdir(to, { recursive: true, mode: 0o700 }); continue; }
    if (entry.type === 'link') { links.push({ from, to, target: entry.target }); continue; }
    const before = await physicalFsp.lstat(from); assert(before.isFile() && !before.isSymbolicLink(), 'SOURCE_CHANGED');
    // Flush while the writable handle is open. Windows cannot fsync a read-only
    // handle, and reopening after copying would also fail for read-only sources.
    const out = physicalFs.createWriteStream(to, { flags: 'wx', mode: 0o600, flush:true });
    const input=physicalFs.createReadStream(from);let copied=0;
    input.on('data',chunk=>{copied+=chunk.length;progress({phase:'protecting',completed:completed+copied,total:manifest.bytes});});
    await pipeline(input, out, { signal });
    progress({phase:'verifying',completed:0,total:0});
    assert(await hashFile(to, signal) === entry.sha256 && await hashFile(from, signal) === entry.sha256, 'COPY_NOT_VERIFIED');
    // Copies of executables must retain their executable bits; directories remain private.
    await physicalFsp.chmod(to, entry.mode & 0o700);
    completed += entry.bytes; progress({ phase: 'protecting', completed, total: manifest.bytes });
  }
  for (const link of links) { assert(await physicalFsp.readlink(link.from) === link.target && inside(target, path.resolve(path.dirname(link.to), link.target)), 'SOURCE_CHANGED'); await physicalFsp.symlink(link.target, link.to); }
  const after = await inventory(source, signal, () => {}, { links: links.length > 0 });
  assert(JSON.stringify(after) === JSON.stringify(manifest), 'SOURCE_CHANGED');
}
export async function verifyInventory(root, manifest, signal) {
  noLinks(root);
  const actual = await inventory(root, signal, () => {}, { links: manifest.entries.some(e => e.type === 'link') });
  // Modes on private copies intentionally differ. Names, kinds, bytes and hashes must match exactly.
  const content = value => value.entries.map(({ mode: _mode, ...entry }) => entry);
  assert(JSON.stringify(content(actual)) === JSON.stringify(content(manifest)), 'COPY_NOT_VERIFIED');
}
export async function sufficientSpace(folder, bytes, copies = 3) {
  const stat = await physicalFsp.statfs(folder, { bigint: true });
  const available = stat.bavail * stat.bsize;
  const required = BigInt(Math.ceil(bytes * copies * 1.1)) + 64n * 1024n * 1024n;
  assert(available >= required, 'NOT_ENOUGH_SPACE'); return { available: String(available), required: String(required) };
}
export async function replaceRecoverably(file, bytes, expectedHash) {
  // Used only for allowlisted configuration files IN A WORKING COPY. The preimage always survives.
  assertWritablePath(file);noLinks(file); assert(await hashFile(file) === expectedHash, 'CONCURRENT_CHANGE');
  const previous = `${file}.support-before-${randomUUID()}`;
  const prepared = `${file}.support-next-${randomUUID()}`;
  await writeNew(prepared, bytes); await physicalFsp.rename(file, previous);
  try { await physicalFsp.rename(prepared, file); } catch (error) { if (!fs.existsSync(file)) await physicalFsp.rename(previous, file); throw error; }
  return previous;
}
