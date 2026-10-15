import { verifyPluginAsset } from './pluginAssets';
import { app } from 'electron';
import { safeStorage } from './secrets/safeStorageGate';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  compareSemver, validatePluginManifest, validateCapabilityManifest,
  type CapabilityManifestV1,
  type CapabilityPermissionSet,
  type InboxPluginSummary,
  type InstalledPluginState,
  type InstalledPluginSummary,
  type PluginPackage,
} from '../skill-capabilities/contracts';
import { mergedPluginPermissions, permissionsExpand, validatePluginPackage, type ValidatedPluginPackage } from '../skill-capabilities/pluginPackage';
import { REGISTERED_BUILTIN_CAPABILITY_IDS } from '../skill-capabilities/registry/catalog';
import { capabilityIsAvailable } from './capabilities/registry';

const pluginsRoot = () => path.join(app.getPath('userData'), 'plugins');
const installedRoot = () => path.join(pluginsRoot(), 'installed');
const stagingRoot = () => path.join(pluginsRoot(), 'staging');
const inboxRoot = () => path.join(pluginsRoot(), 'inbox');
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function initializePluginStore(): void {
  for (const directory of [inboxRoot(), stagingRoot(), installedRoot()]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Staging is disposable by design; no staged package can ever become active
  // after an interrupted validation or write.
  for (const entry of fs.readdirSync(stagingRoot(), { withFileTypes: true })) if (entry.isDirectory()) fs.rmSync(path.join(stagingRoot(), entry.name), { recursive: true, force: true });
  scanPluginInbox();
}

export interface PluginInstallOptions {
  sourceId: string;
  sourcePath?: string;
  sourceCommit?: string;
  approvePermissions?: boolean;
  autoUpdate?: boolean;
  allowRollback?: boolean;
}

export interface PluginInstallOutcome {
  package: ValidatedPluginPackage;
  state: InstalledPluginState;
  activated: boolean;
}

export interface InstalledCapabilityRuntime {
  pluginId: string;
  pluginVersion: string;
  pluginDigest: string;
  capabilityId: string;
  manifest: CapabilityManifestV1;
  source: string;
  permissions: CapabilityPermissionSet;
  readAsset?: (id: string) => { text: string; asset: import('../packages/capability-api/src/pluginAssets').PluginAsset };
}

export const pluginPackageDigest = (input: PluginPackage | ValidatedPluginPackage) => createHash('sha256').update(JSON.stringify({ manifest: input.manifest, files: Object.fromEntries(Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))) })).digest('hex');
const pluginDir = (id: string) => { if (!slug.test(id)) throw new Error('Invalid plugin id.'); return path.join(installedRoot(), id); };
const statePath = (id: string) => path.join(pluginDir(id), 'state.json');
const versionName = (version: string, digest: string) => `${version}-${digest}`;
const versionDir = (id: string, version: string, digest: string) => path.join(pluginDir(id), 'versions', versionName(version, digest));

export function readPluginState(id: string): InstalledPluginState | null {
  try {
    const value = JSON.parse(fs.readFileSync(statePath(id), 'utf8')) as InstalledPluginState;
    const active = Boolean(value.activeVersion && /^[a-f0-9]{64}$/.test(value.activeDigest));
    const pending = Boolean(value.pendingVersion && value.pendingDigest && /^[a-f0-9]{64}$/.test(value.pendingDigest));
    if (value.id !== id || (!active && !pending)) return null;
    return value;
  } catch { return null; }
}

function writeState(state: InstalledPluginState): InstalledPluginState {
  const target = statePath(state.id); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 }); fs.renameSync(temporary, target);
  return state;
}

function writePackage(directory: string, pkg: ValidatedPluginPackage) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'plugin.json'), pkg.files['plugin.json'] ?? JSON.stringify(pkg.manifest, null, 2), { mode: 0o400 });
  for (const [file, source] of Object.entries(pkg.files)) {
    if (file === 'plugin.json') continue;
    const target = path.join(directory, ...file.split('/')); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const binary = pkg.capabilities.some(cap => cap.manifest.assets?.some(asset => asset.mimeType === 'model/gltf-binary' && cap.path.replace('capability.json', asset.path) === file));
    fs.writeFileSync(target, binary ? Buffer.from(source, 'base64') : source, { mode: 0o400 });
  }
}

function stagePackage(pkg: ValidatedPluginPackage, digest: string): string {
  const stage = path.join(stagingRoot(), `${pkg.manifest.id}-${randomUUID()}`);
  fs.mkdirSync(stagingRoot(), { recursive: true, mode: 0o700 }); writePackage(stage, pkg);
  const target = versionDir(pkg.manifest.id, pkg.manifest.version, digest);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) fs.renameSync(stage, target); else fs.rmSync(stage, { recursive: true, force: true });
  return target;
}

function readRegular(root: string, relative: string, limit: number, encoding: BufferEncoding = 'utf8'): string {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe plugin path.');
  let component = root;
  for (const part of relative.split('/')) { component = path.join(component, part); if (fs.lstatSync(component).isSymbolicLink()) throw new Error('Plugin symlinks are not permitted.'); }
  const target = path.join(root, ...relative.split('/')); const stat = fs.lstatSync(target);
  const realRoot = fs.realpathSync(root), realTarget = fs.realpathSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep))) throw new Error(`Invalid plugin file: ${relative}`);
  return fs.readFileSync(target, encoding);
}

export function readPluginDirectory(directory: string): ValidatedPluginPackage {
  const manifestSource = readRegular(directory, 'plugin.json', 64_000);
  const manifest = validatePluginManifest(JSON.parse(manifestSource));
  const files: Record<string, string> = { 'plugin.json': manifestSource };
  for (const skillPath of manifest.skills ?? []) {
    const source = readRegular(directory, skillPath, 64_000); files[skillPath] = source;
    const skill = JSON.parse(source); const base = skillPath.slice(0, -'skill.json'.length);
    for (const file of ['SKILL.md', ...(skill.tools ?? []).map((tool: { entry: string }) => tool.entry)]) files[base + file] = readRegular(directory, base + file, file === 'SKILL.md' ? 64_000 : 256_000);
  }
  for (const capabilityPath of manifest.capabilities ?? []) {
    const source = readRegular(directory, capabilityPath, 64_000); files[capabilityPath] = source;
    const capability = validateCapabilityManifest(JSON.parse(source)); const base = capabilityPath.slice(0, -'capability.json'.length);
    files[base + capability.entry] = readRegular(directory, base + capability.entry, 256_000);
    for (const asset of capability.assets ?? []) {
      const text = readRegular(directory, base + asset.path, asset.bytes, asset.mimeType === 'model/gltf-binary' ? 'base64' : 'utf8');
      verifyPluginAsset(text, asset);
      files[base + asset.path] = text;
    }
  }
  return validatePluginPackage({ manifest, files });
}

export function installPluginPackage(input: PluginPackage | ValidatedPluginPackage, options: PluginInstallOptions): PluginInstallOutcome {
  const pkg = validatePluginPackage(input as PluginPackage);
  for (const capability of pkg.capabilities) for (const asset of capability.manifest.assets ?? []) {
    verifyPluginAsset(pkg.files[capability.path.replace('capability.json', asset.path)], asset);
  }
  const digest = pluginPackageDigest(pkg), current = readPluginState(pkg.manifest.id);
  if (current && current.sourceId !== options.sourceId) throw new Error('A different source already owns this plugin id.');
  const comparison = current?.activeVersion ? compareSemver(pkg.manifest.version, current.activeVersion) : 1;
  if (current?.activeVersion && comparison < 0 && !options.allowRollback) throw new Error('Plugin downgrades require explicit rollback.');
  if (current?.activeVersion && comparison === 0 && digest !== current.activeDigest) throw new Error('Plugin content changed without a version bump.');
  if (current?.activeVersion && comparison === 0) return { package: pkg, state: current, activated: true };
  stagePackage(pkg, digest);
  if (compareSemver(app.getVersion(), pkg.manifest.compatibility.minNodusVersion) < 0) {
    const now = new Date().toISOString();
    const pending = current ?? { id: pkg.manifest.id, sourceId: options.sourceId, activeVersion: '', activeDigest: '', autoUpdate: options.autoUpdate ?? false, approvedPermissions: {}, installedAt: now, updatedAt: now };
    const state = writeState({ ...pending, sourcePath: options.sourcePath ?? pending.sourcePath, sourceCommit: options.sourceCommit ?? pending.sourceCommit, pendingVersion: pkg.manifest.version, pendingDigest: digest, pendingReason: 'incompatible', updatedAt: now });
    return { package: pkg, state, activated: false };
  }
  const permissions = mergedPluginPermissions(pkg);
  const expanded = current ? permissionsExpand(current.approvedPermissions, permissions) : Object.keys(permissions).some(key => {
    const value = permissions[key as keyof CapabilityPermissionSet]; return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  if (expanded && !options.approvePermissions) {
    const now = new Date().toISOString();
    const pending = current ?? { id: pkg.manifest.id, sourceId: options.sourceId, activeVersion: '', activeDigest: '', autoUpdate: options.autoUpdate ?? options.sourceId === 'nodusresearch/nodus-research-skill-marketplace', approvedPermissions: {}, installedAt: now, updatedAt: now };
    return { package: pkg, state: writeState({ ...pending, sourcePath: options.sourcePath ?? pending.sourcePath, sourceCommit: options.sourceCommit ?? pending.sourceCommit, pendingVersion: pkg.manifest.version, pendingDigest: digest, pendingReason: 'permissions', updatedAt: now }), activated: false };
  }
  const now = new Date().toISOString();
  const state: InstalledPluginState = {
    id: pkg.manifest.id, sourceId: options.sourceId, sourcePath: options.sourcePath ?? current?.sourcePath, sourceCommit: options.sourceCommit ?? current?.sourceCommit, activeVersion: pkg.manifest.version, activeDigest: digest,
    ...(current?.activeVersion ? { previousVersion: current.activeVersion, previousDigest: current.activeDigest } : {}),
    autoUpdate: current?.autoUpdate ?? options.autoUpdate ?? options.sourceId === 'nodusresearch/nodus-research-skill-marketplace',
    approvedPermissions: permissions, installedAt: current?.installedAt ?? now, updatedAt: now,
  };
  const storage = path.join(pluginDir(pkg.manifest.id), 'storage');
  if (current?.activeDigest && fs.existsSync(storage)) {
    const snapshots = path.join(pluginDir(pkg.manifest.id), 'storage-snapshots'); fs.rmSync(snapshots, { recursive: true, force: true });
    fs.mkdirSync(snapshots, { recursive: true, mode: 0o700 }); fs.cpSync(storage, path.join(snapshots, current.activeDigest), { recursive: true });
  }
  writeState(state);
  const keep = new Set([versionName(state.activeVersion, state.activeDigest), state.previousVersion && state.previousDigest ? versionName(state.previousVersion, state.previousDigest) : '']);
  const versions = path.join(pluginDir(pkg.manifest.id), 'versions');
  for (const entry of fs.readdirSync(versions, { withFileTypes: true })) if (entry.isDirectory() && !keep.has(entry.name)) fs.rmSync(path.join(versions, entry.name), { recursive: true, force: true });
  return { package: pkg, state, activated: true };
}

export function listInstalledPlugins(): InstalledPluginSummary[] {
  try {
    return fs.readdirSync(installedRoot(), { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
      const state = readPluginState(entry.name); if (!state) return [];
      try {
        const version = state.activeVersion || state.pendingVersion!, digest = state.activeDigest || state.pendingDigest!;
        const manifest = JSON.parse(fs.readFileSync(path.join(versionDir(state.id, version, digest), 'plugin.json'), 'utf8'));
        const root = versionDir(state.id, version, digest), stored = readSecrets(state.id);
        const secrets = (manifest.capabilities as string[]).flatMap(capabilityPath => {
          try { const capability = JSON.parse(fs.readFileSync(path.join(root, capabilityPath), 'utf8')) as CapabilityManifestV1; return (capability.permissions.secrets ?? []).map(secret => ({ capabilityId: capability.id, id: secret.id, label: secret.label, required: secret.required, configured: Boolean(stored[`${capability.id}:${secret.id}`]) })); }
          catch { return []; }
        });
        return [{ ...state, name: manifest.name, description: manifest.description, skills: manifest.skills, capabilities: manifest.capabilities, secrets }];
      } catch { return []; }
    });
  } catch { return []; }
}

export function setPluginAutoUpdate(id: string, enabled: boolean): InstalledPluginSummary[] {
  const state = readPluginState(id); if (!state) throw new Error('Plugin is not installed.'); writeState({ ...state, autoUpdate: enabled, updatedAt: new Date().toISOString() }); return listInstalledPlugins();
}

export function approvePendingPlugin(id: string): PluginInstallOutcome {
  const state = readPluginState(id);
  if (!state?.pendingVersion || !state.pendingDigest) throw new Error('Plugin has no update awaiting approval.');
  if (state.pendingReason !== 'permissions') throw new Error('This pending plugin is not compatible with the current Nodus version.');
  const pkg = readVersionPackage(id, state.pendingVersion, state.pendingDigest);
  return installPluginPackage(pkg, { sourceId: state.sourceId, sourcePath: state.sourcePath, sourceCommit: state.sourceCommit, approvePermissions: true, autoUpdate: state.autoUpdate });
}

export function rollbackPlugin(id: string): InstalledPluginState {
  const state = readPluginState(id); if (!state?.previousVersion || !state.previousDigest) throw new Error('No previous plugin version is available.');
  const next = { ...state, activeVersion: state.previousVersion, activeDigest: state.previousDigest, previousVersion: state.activeVersion, previousDigest: state.activeDigest, pendingVersion: undefined, pendingDigest: undefined, pendingReason: undefined, updatedAt: new Date().toISOString() };
  const snapshots = path.join(pluginDir(id), 'storage-snapshots'), snapshot = path.join(snapshots, next.activeDigest), storage = path.join(pluginDir(id), 'storage');
  if (fs.existsSync(storage)) { fs.mkdirSync(snapshots, { recursive: true, mode: 0o700 }); fs.rmSync(path.join(snapshots, state.activeDigest), { recursive: true, force: true }); fs.cpSync(storage, path.join(snapshots, state.activeDigest), { recursive: true }); }
  if (fs.existsSync(snapshot)) { fs.rmSync(storage, { recursive: true, force: true }); fs.cpSync(snapshot, storage, { recursive: true }); }
  return writeState(next);
}

export function removePlugin(id: string): InstalledPluginSummary[] {
  fs.rmSync(pluginDir(id), { recursive: true, force: true }); return listInstalledPlugins();
}

export function resolveInstalledCapability(id: string, snapshot?: { version: string; digest: string }): InstalledCapabilityRuntime | null {
  const split = id.lastIndexOf(':'); if (split <= 0) return null;
  const pluginId = id.slice(0, split), capabilityId = id.slice(split + 1), state = readPluginState(pluginId);
  if (!state?.activeVersion) return null;
  const selected = snapshot ?? { version: state.activeVersion, digest: state.activeDigest };
  const available = selected.version === state.activeVersion && selected.digest === state.activeDigest
    || selected.version === state.previousVersion && selected.digest === state.previousDigest;
  if (!available) return null;
  const root = versionDir(pluginId, selected.version, selected.digest), relative = `capabilities/${capabilityId}/capability.json`;
  try {
    const manifest = validateCapabilityManifest(JSON.parse(readRegular(root, relative, 64_000)));
    const source = readRegular(root, `capabilities/${capabilityId}/${manifest.entry}`, 256_000);
    return { pluginId, pluginVersion: selected.version, pluginDigest: selected.digest, capabilityId: id, manifest, source, permissions: state.approvedPermissions, readAsset: (assetId: string) => {
      const asset = manifest.assets?.find(item => item.id === assetId);
      if (!asset) throw new Error('Plugin asset is not declared by this capability.');
      const text = readRegular(root, `capabilities/${capabilityId}/${asset.path}`, asset.bytes, asset.mimeType === 'model/gltf-binary' ? 'base64' : 'utf8');
      verifyPluginAsset(text, asset);
      return { text, asset };
    } };
  } catch { return null; }
}

/** Normalizing a short name is not resolving it: `chemistry` still reads as
 *  `nodus:chemistry` with no package installed, and still is not available. */
export function installedCapabilityAvailable(id: string): boolean {
  return REGISTERED_BUILTIN_CAPABILITY_IDS.includes(id as typeof REGISTERED_BUILTIN_CAPABILITY_IDS[number])
    || capabilityIsAvailable(id)
    || Boolean(resolveInstalledCapability(id));
}

function secretsPath(id: string) { return path.join(pluginDir(id), 'secrets.bin'); }
function readSecrets(id: string): Record<string, string> {
  if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(secretsPath(id))) return {};
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsPath(id)))); } catch { return {}; }
}
export function configurePluginSecret(pluginId: string, capabilityId: string, secretId: string, value: string): InstalledPluginSummary[] {
  const runtime = resolveInstalledCapability(`${pluginId}:${capabilityId}`), permission = runtime?.manifest.permissions.secrets?.find(secret => secret.id === secretId);
  if (!runtime || !permission) throw new Error('Unknown plugin secret.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The secure credential store is unavailable.');
  const secrets = readSecrets(pluginId); const key = `${capabilityId}:${secretId}`;
  if (value.trim()) secrets[key] = value.trim(); else delete secrets[key];
  fs.writeFileSync(secretsPath(pluginId), safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 }); return listInstalledPlugins();
}
export function pluginSecret(pluginId: string, capabilityId: string, secretId: string): string | undefined { return readSecrets(pluginId)[`${capabilityId}:${secretId}`]; }

export function pluginStorageFile(pluginId: string, capabilityId: string): string {
  if (!slug.test(pluginId) || !slug.test(capabilityId)) throw new Error('Invalid plugin storage namespace.');
  return path.join(pluginDir(pluginId), 'storage', `${capabilityId}.json`);
}

export function scanPluginInbox(): Array<{ directory: string; package: ValidatedPluginPackage; installed: boolean }> {
  try {
    return fs.readdirSync(inboxRoot(), { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
      try { const pkg = readPluginDirectory(path.join(inboxRoot(), entry.name)); return [{ directory: path.join(inboxRoot(), entry.name), package: pkg, installed: Boolean(readPluginState(pkg.manifest.id)) }]; }
      catch { return []; }
    });
  } catch { return []; }
}

/** What the review screen shows for a plugin dropped into the profile inbox. Nothing
 *  here is loaded or executed; only the manifest is read, and only after validation. */
export function listInboxPlugins(): InboxPluginSummary[] {
  return scanPluginInbox().map(({ directory, package: pkg, installed }) => ({
    directory, installed, id: pkg.manifest.id, name: pkg.manifest.name, description: pkg.manifest.description,
    version: pkg.manifest.version, author: pkg.manifest.author,
    skills: pkg.manifest.skills.length, capabilities: pkg.manifest.capabilities.length,
    permissions: mergedPluginPermissions(pkg),
  }));
}

/** Read a package the user picked in the inbox, refusing any path outside it. */
export function readInboxPlugin(directory: string): ValidatedPluginPackage {
  const resolved = path.resolve(directory);
  const root = path.resolve(inboxRoot());
  if (resolved === root || !resolved.startsWith(root + path.sep)) throw new Error('That directory is not in the plugin inbox.');
  return readPluginDirectory(resolved);
}

/** Remove an approved package from the inbox once it has been installed. */
export function discardInboxPlugin(directory: string): void {
  const resolved = path.resolve(directory);
  const root = path.resolve(inboxRoot());
  if (resolved === root || !resolved.startsWith(root + path.sep)) throw new Error('That directory is not in the plugin inbox.');
  fs.rmSync(resolved, { recursive: true, force: true });
}

function readVersionPackage(id: string, version: string, digest: string): ValidatedPluginPackage {
  return readPluginDirectory(versionDir(id, version, digest));
}

export function readActivePluginPackage(id: string): ValidatedPluginPackage {
  const state = readPluginState(id);
  if (!state?.activeVersion) throw new Error('Plugin is not active.');
  return readVersionPackage(id, state.activeVersion, state.activeDigest);
}
