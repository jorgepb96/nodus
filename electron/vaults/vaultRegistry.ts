import Database from 'better-sqlite3';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import type { VaultOrigin, VaultRemote, VaultSummary, VaultType } from '@shared/types';
import { normalizeVaultType } from '@shared/vaultTypes';
import { runMigrations, SCHEMA_VERSION } from '../db/migrations';
import { auditQaDatabaseOpen } from '../qa/databaseAudit';
import { migrateDatabaseSafely } from '../db/migrationSafety';
import { scheduleMigrationRecoveryRetention } from '../db/migrationRecoveryUtilityHost';

interface VaultRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  legacy: boolean;
  type: VaultType;
  /**
   * Where this vault's canonical data lives.
   *
   * 'local'     — the SQLite here IS the vault. The historical and default case.
   * 'connected' — this SQLite is a replica of a Nodus Server space. It is still a real,
   *               fully migrated database that every repository reads normally; what
   *               differs is that a remote publication can overwrite rows in it, and that
   *               what the user writes may (or may not, for a reader) travel back.
   */
  origin: VaultOrigin;
  remote?: VaultRemote;
}

interface VaultRegistryFile {
  formatVersion: 1;
  activeVaultId: string;
  vaults: VaultRecord[];
}

const REGISTRY_FILE = 'vaults.json';
const LEGACY_VAULT_ID = 'default';

function userDataDir(): string {
  return app.getPath('userData');
}

function registryPath(): string {
  return path.join(userDataDir(), REGISTRY_FILE);
}

function legacyDbPath(): string {
  return path.join(userDataDir(), 'nodus.sqlite');
}

function vaultsDir(): string {
  return path.join(userDataDir(), 'vaults');
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed || 'Nueva bóveda';
}

/**
 * `normalizeRegistry` rebuilds each record field by field and drops what it does not know,
 * so an older Nodus opening a newer vaults.json would quietly demote a connected vault to a
 * local one. The remote block is therefore mirrored next to the database as remote.json and
 * re-read from there, which is also where `readVaultRemote` recovers it from.
 */
function normalizeRemote(input: VaultRemote): VaultRemote {
  return {
    serverKind: input.serverKind === 'cloudflare' ? 'cloudflare' : 'classic',
    url: String(input.url ?? ''),
    spaceId: String(input.spaceId ?? ''),
    spaceName: String(input.spaceName ?? ''),
    serverName: String(input.serverName ?? ''),
    userEmail: String(input.userEmail ?? ''),
    role: input.role === 'owner' || input.role === 'writer' ? input.role : 'reader',
    state: input.state === 'revoked' || input.state === 'paused' ? input.state : 'active',
    lastPulledRevision: input.lastPulledRevision ?? null,
    lastPulledAt: input.lastPulledAt ?? null,
  };
}

function defaultVaultRecord(): VaultRecord {
  const now = nowIso();
  return {
    id: LEGACY_VAULT_ID,
    name: 'Principal',
    path: legacyDbPath(),
    createdAt: now,
    lastOpenedAt: now,
    legacy: true,
    type: 'academic',
    origin: 'local',
  };
}

function writeRegistry(registry: VaultRegistryFile): VaultRegistryFile {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const target = registryPath();
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), 'utf8');
  fs.renameSync(temporary, target);
  return registry;
}

function normalizeRegistry(input: VaultRegistryFile): VaultRegistryFile {
  const seen = new Set<string>();
  const vaults = input.vaults
    .filter((vault) => vault && typeof vault.id === 'string' && typeof vault.path === 'string')
    .map((vault) => ({
      id: vault.id,
      name: cleanName(vault.name || 'Nueva bóveda'),
      path: path.resolve(vault.path),
      createdAt: vault.createdAt || nowIso(),
      lastOpenedAt: vault.lastOpenedAt || vault.createdAt || nowIso(),
      legacy: Boolean(vault.legacy),
      // Pre-existing vaults have no `type`; they default to academic.
      type: normalizeVaultType(vault.type),
      // …and none of them have an `origin` either. Same retrofit, same default.
      origin: (vault.origin === 'connected' ? 'connected' : 'local') as VaultOrigin,
      ...(vault.remote ? { remote: normalizeRemote(vault.remote) } : {}),
    }))
    .filter((vault) => {
      if (seen.has(vault.id)) return false;
      seen.add(vault.id);
      return true;
    });

  for (const vault of vaults) {
    if (vault.origin === 'connected' && vault.remote) continue;
    const recovered = readVaultRemoteFile(vault.path);
    if (recovered) { vault.origin = 'connected'; vault.remote = recovered; }
  }

  if (!vaults.some((vault) => vault.id === LEGACY_VAULT_ID)) {
    vaults.unshift(defaultVaultRecord());
  }

  const activeVaultId = vaults.some((vault) => vault.id === input.activeVaultId)
    ? input.activeVaultId
    : LEGACY_VAULT_ID;

  return { formatVersion: 1, activeVaultId, vaults };
}

export function ensureVaultRegistry(): VaultRegistryFile {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const file = registryPath();
  if (!fs.existsSync(file)) {
    return writeRegistry({
      formatVersion: 1,
      activeVaultId: LEGACY_VAULT_ID,
      vaults: [defaultVaultRecord()],
    });
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as VaultRegistryFile;
    const normalized = normalizeRegistry(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) writeRegistry(normalized);
    return normalized;
  } catch {
    return writeRegistry({
      formatVersion: 1,
      activeVaultId: LEGACY_VAULT_ID,
      vaults: [defaultVaultRecord()],
    });
  }
}

function writeVaultManifest(vault: VaultRecord): void {
  // The remote sidecar is written for the legacy vault too: it has no manifest, but it can
  // still be connected, and losing its remote block would be the same silent demotion.
  writeVaultRemote(vault);
  if (vault.legacy) return;
  const dir = path.dirname(vault.path);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'manifest.json');
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(
    temporary,
    JSON.stringify(
      {
        id: vault.id,
        name: vault.name,
        type: vault.type,
        createdAt: vault.createdAt,
        lastOpenedAt: vault.lastOpenedAt,
        database: path.basename(vault.path),
      },
      null,
      2
    ),
    'utf8'
  );
  fs.renameSync(temporary, target);
}

const REMOTE_FILE = 'remote.json';

/**
 * The remote block, mirrored beside the database.
 *
 * `normalizeRegistry` rebuilds every record from the fields it knows, so a Nodus older than
 * this feature would rewrite vaults.json without `remote` and silently turn a replica into
 * an ordinary local vault — pointed at a database that a server can still overwrite. The
 * sidecar is the authority we can recover from when that happens.
 */
function writeVaultRemote(vault: VaultRecord): void {
  const dir = path.dirname(vault.path);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, REMOTE_FILE);
  if (!vault.remote) { fs.rmSync(target, { force: true }); return; }
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(temporary, JSON.stringify({ vaultId: vault.id, ...vault.remote }, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

export function readVaultRemoteFile(vaultPath: string): VaultRemote | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(path.dirname(vaultPath), REMOTE_FILE), 'utf8')) as VaultRemote;
    return parsed?.spaceId ? normalizeRemote(parsed) : null;
  } catch { return null; }
}

function initializeDatabase(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let db = new Database(file);
  try {
    auditQaDatabaseOpen(file, 'initialize');
    const migrationPending = Number(db.pragma('user_version', { simple: true })) < SCHEMA_VERSION;
    db = migrateDatabaseSafely(db, file, SCHEMA_VERSION, runMigrations);
    if (migrationPending) scheduleMigrationRecoveryRetention(file);
  } finally {
    db.close();
  }
}

function removeSqliteDatabaseFiles(file: string): void {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    fs.rmSync(candidate, { force: true });
  }
}

function toSummary(vault: VaultRecord, activeVaultId: string): VaultSummary {
  return {
    id: vault.id,
    name: vault.name,
    path: vault.path,
    createdAt: vault.createdAt,
    lastOpenedAt: vault.lastOpenedAt,
    origin: vault.origin,
    remote: vault.remote ?? null,
    active: vault.id === activeVaultId,
    legacy: vault.legacy,
    type: vault.type,
    apiKeyProviders: [],
  };
}

export function listVaults(): VaultSummary[] {
  const registry = ensureVaultRegistry();
  return registry.vaults.map((vault) => toSummary(vault, registry.activeVaultId));
}

const owningVaultContext = new AsyncLocalStorage<string>();
let activeVaultEpoch = 0;
/** In-flight UI reads are invalid even when the reader switches away and back. */
export function activeVaultRevision(): number { return activeVaultEpoch; }

/** Explicit background owner; never changes the UI's active-vault registry. */
export function withOwningVault<T>(vaultId: string, work: () => T): T {
  if (!getVault(vaultId)) throw new Error('research_vault_unavailable');
  return owningVaultContext.run(vaultId, work);
}
export function withoutOwningVault<T>(work: () => T): T { return owningVaultContext.exit(work); }

export function getActiveVault(): VaultSummary {
  const owner = owningVaultContext.getStore();
  if (owner) {
    const vault = getVault(owner);
    if (!vault) throw new Error('research_vault_unavailable');
    return vault;
  }
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === registry.activeVaultId) ?? registry.vaults[0];
  return toSummary(vault, registry.activeVaultId);
}

export function getVault(id: string): VaultSummary | null {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  return vault ? toSummary(vault, registry.activeVaultId) : null;
}

/**
 * The vault a database file belongs to.
 *
 * `openDatabase()` is handed a path, not a vault id — a background job may be opening a
 * sibling vault — and it has to know whether that database is a replica before it decides
 * which triggers to install.
 */
export function getVaultByPath(dbPath: string): VaultSummary | null {
  const registry = ensureVaultRegistry();
  const resolved = path.resolve(dbPath);
  const vault = registry.vaults.find((candidate) => candidate.path === resolved);
  return vault ? toSummary(vault, registry.activeVaultId) : null;
}

export function activeVaultDbPath(): string {
  return getActiveVault().path;
}

export function activeVaultDir(): string {
  return path.dirname(activeVaultDbPath());
}

export function vaultDir(vaultId: string): string | null {
  const vault = getVault(vaultId);
  return vault ? path.dirname(vault.path) : null;
}

export function createVault(
  name: string,
  type: VaultType = 'academic',
  options: { origin?: VaultOrigin; remote?: VaultRemote } = {},
): VaultSummary {
  const registry = ensureVaultRegistry();
  const id = randomUUID();
  const createdAt = nowIso();
  const dir = path.join(vaultsDir(), id);
  const vault: VaultRecord = {
    id,
    name: cleanName(name),
    path: path.join(dir, 'nodus.sqlite'),
    createdAt,
    lastOpenedAt: createdAt,
    legacy: false,
    type: normalizeVaultType(type),
    origin: options.origin === 'connected' ? 'connected' : 'local',
    ...(options.remote ? { remote: normalizeRemote(options.remote) } : {}),
  };
  initializeDatabase(vault.path);
  writeVaultManifest(vault);
  registry.vaults.push(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

/**
 * Restore a vault's database from a backup, KEYED BY ITS ORIGINAL ID. If a vault with
 * that id already exists locally its database file is replaced in place; otherwise the
 * vault is registered (recreating the folder for a non-legacy vault, or the legacy
 * path for the primary one). The copied file's stale WAL/SHM siblings are cleared so
 * SQLite never replays an old journal over the restored data. Migrations run lazily
 * when the vault is next opened. Does NOT touch the live DB connection — the caller
 * must closeDb() before restoring the active vault and reopen afterwards.
 */
export function restoreVaultDatabase(
  input: { id: string; name: string; type: VaultType; legacy: boolean },
  sourceFile: string
): void {
  const registry = ensureVaultRegistry();
  let record = registry.vaults.find((v) => v.id === input.id);
  if (record) {
    record.name = cleanName(input.name);
    record.type = normalizeVaultType(input.type);
    record.lastOpenedAt = nowIso();
  } else {
    const legacy = input.legacy || input.id === LEGACY_VAULT_ID;
    const target = legacy ? legacyDbPath() : path.join(vaultsDir(), input.id, 'nodus.sqlite');
    record = {
      id: input.id,
      name: cleanName(input.name),
      path: target,
      createdAt: nowIso(),
      lastOpenedAt: nowIso(),
      legacy,
      type: normalizeVaultType(input.type),
      // A restored backup is a local vault. If it was a replica, its remote block is
      // recovered from the remote.json sidecar the next time the registry normalizes.
      origin: 'local',
    };
    registry.vaults.push(record);
  }
  fs.mkdirSync(path.dirname(record.path), { recursive: true });
  // Stage the incoming database as a sibling first. Copying straight over the live
  // file means a failure mid-copy (disk full, volume unmounted, power loss) leaves a
  // truncated file where a vault used to be — and the caller's rollback would hit the
  // same wall. A rename() within one directory is atomic and writes no content, so the
  // old vault survives every failure up to the instant it is replaced.
  const staged = `${record.path}.incoming-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    fs.copyFileSync(sourceFile, staged);
    // Only metadata operations from here on: the stale WAL/SHM must not outlive the
    // file they describe, and Windows refuses to rename onto an existing target.
    removeSqliteDatabaseFiles(record.path);
    fs.renameSync(staged, record.path);
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }
  writeVaultManifest(record);
  writeRegistry(registry);
}

export function createVaultFromDatabaseFile(
  sourceFile: string,
  name: string,
  type: VaultType = 'academic'
): VaultSummary {
  const registry = ensureVaultRegistry();
  const id = randomUUID();
  const createdAt = nowIso();
  const dir = path.join(vaultsDir(), id);
  const vault: VaultRecord = {
    id,
    name: cleanName(name),
    path: path.join(dir, 'nodus.sqlite'),
    createdAt,
    lastOpenedAt: createdAt,
    legacy: false,
    type: normalizeVaultType(type),
    // A vault restored from a database file the user picked is always local: there is
    // no server behind it, and no remote block to carry.
    origin: 'local',
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(sourceFile, vault.path);
  // A migration recovery snapshot is intentionally read-only. Its new vault copy must be
  // writable before migrations can bring it to the current schema.
  fs.chmodSync(vault.path, 0o600);
  initializeDatabase(vault.path);
  writeVaultManifest(vault);
  registry.vaults.push(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function renameVault(id: string, name: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  vault.name = cleanName(name);
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function setVaultType(id: string, type: VaultType): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  vault.type = normalizeVaultType(type);
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function setActiveVault(id: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  vault.lastOpenedAt = nowIso();
  if (registry.activeVaultId !== id) activeVaultEpoch += 1;
  registry.activeVaultId = id;
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function deleteVault(id: string, deleteFiles: boolean): void {
  const registry = ensureVaultRegistry();
  if (id === registry.activeVaultId) throw new Error('No puedes borrar la bóveda activa.');
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) return;
  if (vault.legacy) throw new Error('No puedes borrar la bóveda principal. Reinicialízala si quieres vaciarla.');
  registry.vaults = registry.vaults.filter((candidate) => candidate.id !== id);
  writeRegistry(registry);
  if (deleteFiles && !vault.legacy) {
    fs.rmSync(path.dirname(vault.path), { recursive: true, force: true });
  }
}

export function resetVaultDatabase(id: string): VaultSummary {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault) throw new Error('Bóveda no encontrada.');
  removeSqliteDatabaseFiles(vault.path);
  initializeDatabase(vault.path);
  vault.lastOpenedAt = nowIso();
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

/**
 * Update the remote block of a connected vault.
 *
 * Called on every pull (to advance the revision), when the server reports a different role,
 * and when access is revoked. A revocation only sets `state`: the replica keeps every byte
 * it has, because deleting a colleague's own notes because a server said no is not a
 * recovery, it is data loss.
 */
export function updateVaultRemote(id: string, patch: Partial<VaultRemote>): VaultSummary | null {
  const registry = ensureVaultRegistry();
  const vault = registry.vaults.find((candidate) => candidate.id === id);
  if (!vault || !vault.remote) return null;
  vault.remote = normalizeRemote({ ...vault.remote, ...patch });
  writeVaultManifest(vault);
  writeRegistry(registry);
  return toSummary(vault, registry.activeVaultId);
}

export function vaultExists(id: string): boolean {
  return getVault(id) !== null;
}
