// osx-sign's generic binary detector also selects Python data and recordings.
// Only Mach-O code and code bundles need individual signatures; other resources
// remain protected by the enclosing bundle's resource seal.
const fs = require('node:fs');
const path = require('node:path');
const MACH_MAGICS = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
const BUNDLES = new Set(['.app', '.framework', '.appex', '.bundle', '.docktileplugin', '.plugin', '.xpc']);
function isSigningTarget(filePath) {
  const stat = fs.statSync(filePath); // Follow symlinks; unreadable/missing code fails the build.
  if (stat.isDirectory()) return BUNDLES.has(path.extname(filePath).toLowerCase());
  if (!stat.isFile()) throw new Error(`Unsupported signing target: ${filePath}`);
  const fd = fs.openSync(filePath, 'r');
  try {
    const magic = Buffer.alloc(4);
    return fs.readSync(fd, magic, 0, 4, 0) === 4 && MACH_MAGICS.has(magic.toString('hex'));
  } finally { fs.closeSync(fd); }
}
function signingIgnore(filePath, originalIgnore) {
  if (!isSigningTarget(filePath)) return true;
  if (typeof originalIgnore === 'function') return originalIgnore(filePath);
  if (Array.isArray(originalIgnore)) return originalIgnore.some(rule => typeof rule === 'function' ? rule(filePath) : filePath.match(rule));
  return false;
}
function additionalSigningTargets(app) {
  const targets = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue; // The real target is visited once, without framework cycles.
      if (entry.isDirectory()) { walk(candidate); if (isSigningTarget(candidate)) targets.push(candidate); }
      else if (isSigningTarget(candidate)) targets.push(candidate);
    }
  }
  walk(path.join(app, 'Contents'));
  return targets;
}
module.exports = { isSigningTarget, signingIgnore, additionalSigningTargets };
