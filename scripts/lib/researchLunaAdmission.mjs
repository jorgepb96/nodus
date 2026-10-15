import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function poolDirectory(root) {
  if (!path.isAbsolute(root ?? '')) throw new Error('A shared isolated generator pool root is required');
  const resolved = fs.realpathSync(root);
  const manifestFile = path.join(resolved, 'isolation.json');
  const stat = fs.lstatSync(manifestFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe isolation manifest');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.format !== 'nodus.isolated-research-profile/1' || manifest.root !== resolved) throw new Error('Invalid isolated generator pool root');
  const artifacts = path.join(resolved, 'artifacts');
  if (!fs.lstatSync(artifacts).isDirectory() || fs.lstatSync(artifacts).isSymbolicLink()) throw new Error('Unsafe pool artifacts');
  const directory = path.join(artifacts, 'generator-pool');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe pool directory');
  return directory;
}

export function initializeResearchLunaPool(root, slots) {
  if (!Number.isSafeInteger(slots) || slots < 1 || slots > 3) throw new Error('Generator slots must be 1–3');
  const directory = poolDirectory(root);
  const file = path.join(directory, 'capacity.json');
  fs.writeFileSync(file, JSON.stringify({ format: 'nodus.luna-generator-pool/1', slots }), { flag: 'wx', mode: 0o600 });
  return { root: fs.realpathSync(root), slots };
}

/** A producer holds one real generator slot for its whole segment. Concurrent
 * producers must share this pool; a crash leaves the lease for explicit review.
 * No PID guessing or automatic reclamation can start duplicate work. */
export function acquireResearchLunaSlot(root, producerRoot) {
  const directory = poolDirectory(root);
  const capacityFile = path.join(directory, 'capacity.json');
  const stat = fs.lstatSync(capacityFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('Unsafe pool capacity');
  const capacity = JSON.parse(fs.readFileSync(capacityFile, 'utf8'));
  if (capacity.format !== 'nodus.luna-generator-pool/1' || !Number.isSafeInteger(capacity.slots) || capacity.slots < 1 || capacity.slots > 3) throw new Error('Invalid pool capacity');
  // Validate the producer's isolation marker too, without opening its databases.
  poolDirectory(producerRoot);
  for (let slot = 0; slot < capacity.slots; slot++) {
    const file = path.join(directory, `slot-${slot}.json`);
    const lease = { token: randomUUID(), pid: process.pid, producerRoot: fs.realpathSync(producerRoot), acquiredAt: new Date().toISOString() };
    const bytes = JSON.stringify(lease);
    try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    let released = false;
    return { slot, poolRoot: fs.realpathSync(root), slots: capacity.slots, release() {
      if (released) return;
      const current = fs.lstatSync(file);
      if (!current.isFile() || current.isSymbolicLink() || fs.readFileSync(file, 'utf8') !== bytes) throw new Error('Generator lease changed; refusing release');
      fs.unlinkSync(file); released = true;
    } };
  }
  throw new Error('Generator pool is full; do not start another producer until a generator slot is free');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => { const at = arg.indexOf('='); return [arg.slice(2, at), arg.slice(at + 1)]; }));
    console.log(JSON.stringify(initializeResearchLunaPool(args.root, Number(args.slots))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
