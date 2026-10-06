/** Explicitly authorized, read-only import of exactly two encrypted provider files.
 * Never imports Nodus modules, preferences, registries or migration helpers. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function importResearchTestCredentials(root, isolatedSource, providers = ['deepseek', 'openrouter']) {
  const resolved = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(resolved, 'isolation.json'), 'utf8'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== resolved) throw new Error('Invalid isolated credential destination');
  let copiedSource;
  if (isolatedSource) {
    copiedSource = fs.realpathSync(isolatedSource);
    const sourceMarker = JSON.parse(fs.readFileSync(path.join(copiedSource, 'isolation.json'), 'utf8'));
    if (sourceMarker.format !== 'nodus.isolated-research-profile/1' || sourceMarker.root !== copiedSource) throw new Error('Invalid isolated credential source');
  }
  const target = path.join(resolved, 'profile/secrets');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(target) !== target) throw new Error('Credential destination contains a symlink');
  const imported = [];
  if (!Array.isArray(providers) || providers.some(provider => !['deepseek', 'openrouter'].includes(provider))) throw new Error('Invalid QA credential provider');
  for (const provider of providers) {
    const filename = `ai_key_${provider}.bin`;
    // These are the only production files this helper may read. A missing file
    // is a missing credential, never permission to scan vaults or keychains.
    const candidates = copiedSource ? [path.join(copiedSource, 'profile/secrets', filename)] : ['Nodus', 'nodus'].map(name => path.join(os.homedir(), 'Library/Application Support', name, 'secrets', filename));
    const source = candidates.find(file => fs.existsSync(file));
    if (!source) throw new Error(`Authorized ${provider} credential not found`);
    if (fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== source) throw new Error('Credential source cannot contain a symlink');
    const bytes = fs.readFileSync(source);
    if (bytes.subarray(0, 4).toString() === 'b64:') throw new Error('Legacy plaintext credential requires a separate encrypted import');
    fs.writeFileSync(path.join(target, filename), bytes, { flag: 'wx', mode: 0o600 });
    imported.push(provider);
  }
  return { imported, encryptedAtRest: true };
}
