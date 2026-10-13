import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function marked(root) {
  const real = fs.realpathSync(root);
  const markerPath = path.join(real, 'isolation.json');
  const stat = fs.lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink() || real === path.parse(real).root) throw new Error('Invalid QA resource root');
  const marker = JSON.parse(fs.readFileSync(markerPath));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== real) throw new Error('Unmarked QA resource root');
  return real;
}

/** Copy one independently pinned file between marked QA roots, without fallback. */
export function copyResearchQaPinnedResource({ sourceRoot, targetRoot, relativePath, sha256, bytes }) {
  const source = marked(sourceRoot), target = marked(targetRoot);
  if (source === target || typeof relativePath !== 'string' || path.isAbsolute(relativePath)
      || relativePath.split(/[\\/]/u).some(part => !part || part === '.' || part === '..')
      || !/^[a-f0-9]{64}$/u.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Invalid pinned QA resource copy');
  const sourcePath = path.join(source, relativePath), targetPath = path.join(target, relativePath);
  const stat = fs.lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(sourcePath) !== sourcePath || stat.size !== bytes) throw new Error('QA resource source path/size mismatch');
  const content = fs.readFileSync(sourcePath);
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== sha256 || content.length !== bytes) throw new Error('QA resource SHA-256 mismatch');
  let parent = target;
  for (const part of relativePath.split(/[\\/]/u).slice(0, -1)) {
    const next = path.join(parent, part);
    if (fs.existsSync(next)) {
      const directory = fs.lstatSync(next);
      if (!directory.isDirectory() || directory.isSymbolicLink() || fs.realpathSync(next) !== next) throw new Error('QA resource target redirects outside its root');
    } else fs.mkdirSync(next, { mode: 0o700 });
    parent = next;
  }
  fs.writeFileSync(targetPath, content, { flag: 'wx', mode: 0o600 });
  return { sourceRoot: source, sourcePath, sourceSha256: digest, targetPath, bytes };
}
