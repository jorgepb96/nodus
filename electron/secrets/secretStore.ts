import { app } from 'electron';
import { harnessApiKey, safeStorage } from './safeStorageGate';
import fs from 'node:fs';
import path from 'node:path';
import type { AiProvider } from '@shared/types';
import { AI_PROVIDERS, SECRET_PROVIDERS as PROVIDERS } from '@shared/providers';
import { activeVaultDir, getActiveVault, listVaults, vaultDir } from '../vaults/vaultRegistry';

// AI API keys are stored per provider, encrypted-at-rest via Electron safeStorage,
// never in the renderer and never in plaintext on disk. Keys never cross IPC to the UI.
// Keys are SHARED GLOBALLY across every vault (a single encrypted file per provider in
// userData/secrets), so configuring a provider once makes it available in all vaults.
// Legacy per-vault keys are migrated up to the shared store on first read.
// Local providers (ollama, lmstudio) are included so an optional access token for
// a secured instance is stored/cleared through the same encrypted-at-rest path.

function keyFileInDir(dir: string, provider: AiProvider): string {
  return path.join(dir, `ai_key_${provider}.bin`);
}

function globalSecretsDir(): string {
  return path.join(app.getPath('userData'), 'secrets');
}

function keyFile(provider: AiProvider): string {
  return keyFileInDir(globalSecretsDir(), provider);
}

function legacyRootKeyFile(provider: AiProvider): string {
  return keyFileInDir(app.getPath('userData'), provider);
}

/** The released userData roots this profile may migrate from.
 *
 * app.setName('Nodus') also changed the default userData casing on
 * case-sensitive systems, so the default profile scans both released spellings;
 * inode/path deduplication below makes that harmless on Windows and macOS.
 *
 * An ISOLATED profile (NODUS_USERDATA — tests, the demo instance, a second copy
 * opened on purpose) is a different install that merely sits next to the real
 * one. It must never reach into its neighbour: these paths are not only read,
 * they are retired and deleted, so scanning the sibling would let a throwaway
 * profile destroy the user's real API keys. */
function historicalRoots(currentRoot: string): string[] {
  if (path.basename(currentRoot).toLowerCase() !== 'nodus') return [currentRoot];
  const parent = path.dirname(currentRoot);
  return [currentRoot, path.join(parent, 'nodus'), path.join(parent, 'Nodus')];
}

/** Every location used by released Nodus versions. The global file remains the
 * canonical target; the others are read-only recovery candidates. */
export function apiKeyCandidateFiles(provider: AiProvider): string[] {
  const candidates = [keyFile(provider), legacyRootKeyFile(provider)];
  const currentRoot = app.getPath('userData');
  for (const root of [...new Set(historicalRoots(currentRoot))]) {
    candidates.push(keyFileInDir(path.join(root, 'secrets'), provider), keyFileInDir(root, provider));
    const vaultsRoot = path.join(root, 'vaults');
    try {
      for (const name of fs.readdirSync(vaultsRoot)) candidates.push(keyFileInDir(path.join(vaultsRoot, name), provider));
    } catch { /* no historical vault directory */ }
  }
  try {
    candidates.push(...listVaults().map((vault) => keyFileInDir(path.dirname(vault.path), provider)));
  } catch {
    try { candidates.push(keyFileInDir(activeVaultDir(), provider)); } catch { /* no registry yet */ }
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    let identity = path.resolve(candidate);
    try {
      const stat = fs.statSync(candidate);
      identity = `${stat.dev}:${stat.ino}`;
    } catch { /* keep the resolved path identity */ }
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(path.resolve(candidate));
  }
  return unique;
}

function readKeyFile(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const asStr = buf.toString('utf8');
  if (asStr.startsWith('b64:')) return Buffer.from(asStr.slice(4), 'base64').toString('utf8');
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

// Legacy `b64:` blobs are readable only while Safe Storage is available so
// they can be migrated immediately to encryption. They are never usable as a
// plaintext-at-rest fallback when the OS credential store is unavailable.
function readApiKeyFile(file: string): string | null {
  if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
  return readKeyFile(file);
}

export function setApiKey(provider: AiProvider, key: string): void {
  if (provider === 'codex') throw new Error('ChatGPT usa acceso gestionado; Nodus no almacena una clave para este proveedor.');
  if (provider === 'github-copilot') throw new Error('GitHub Copilot usa el acceso oficial de GitHub; Nodus no almacena una clave para este proveedor.');
  if (!key) {
    clearApiKey(provider);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El almacén seguro del sistema no está disponible; la clave no se ha guardado.');
  }
  const file = keyFile(provider);
  const historicalFiles = apiKeyCandidateFiles(provider).filter((candidate) => !sameFile(candidate, file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  preserveLockedFile(file);
  const write = (data: Buffer) => writeSecretAtomically(file, data);
  write(safeStorage.encryptString(key));
  // Once the canonical write is verified, retire exact-name copies from older
  // roots/vaults so a future recovery can never resurrect a stale credential.
  if (readApiKeyFile(file) === key) historicalFiles.forEach(retireHistoricalFile);
}

export function getApiKey(provider: AiProvider): string | null {
  if (provider === 'codex' || provider === 'github-copilot') return null;
  // Harness mode (see safeStorageGate): keys come from the harness file, never the Keychain.
  const fromHarness = harnessApiKey(provider);
  if (fromHarness !== null) return fromHarness;
  const canonical = keyFile(provider);
  const fromGlobal = readApiKeyFile(canonical);
  if (fromGlobal !== null) return fromGlobal;
  // One-time migration: any readable key from a released root/vault location
  // is promoted to the current global store. This also covers Windows/Linux
  // userData casing changes, where the OS credential itself remains readable.
  for (const candidate of apiKeyCandidateFiles(provider)) {
    if (sameFile(candidate, canonical)) continue;
    const legacy = readApiKeyFile(candidate);
    if (legacy !== null) {
      setApiKey(provider, legacy);
      return legacy;
    }
  }
  // Last resort: the emergency archive. Nothing used to read it, so a key that
  // only survived there was lost in practice.
  for (const archived of archivedApiKeyFiles(provider)) {
    const rescued = readApiKeyFile(archived);
    if (rescued !== null) {
      setApiKey(provider, rescued);
      return rescued;
    }
  }
  return null;
}

export function hasApiKey(provider: AiProvider): boolean {
  return getApiKey(provider) !== null;
}

export function clearApiKey(provider: AiProvider): void {
  if (provider === 'codex' || provider === 'github-copilot') return;
  // An explicit delete applies to every released storage location AND to the
  // emergency archive; otherwise an old per-vault copy — or the archive getApiKey
  // now falls back to — would silently recreate the key on the next read.
  for (const file of [...apiKeyCandidateFiles(provider), ...archivedApiKeyFiles(provider)]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    const left = fs.statSync(a);
    const right = fs.statSync(b);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function writeSecretAtomically(file: string, data: Buffer): void {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, data, { mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
}

/** Never overwrite the only copy of a blob that exists but the current OS
 * credential cannot decrypt. This archive is still OS-bound and is not treated
 * as a portable backup; it is only an emergency rollback for the migration. */
function preserveLockedFile(file: string): void {
  if (!fs.existsSync(file) || readKeyFile(file) !== null) return;
  archiveEncryptedFile(file);
}

function lockedArchiveDir(): string {
  return path.join(globalSecretsDir(), 'locked-archive');
}

/** The emergency copies written by preserveLockedFile/retireHistoricalFile,
 * newest first. Deliberately NOT part of apiKeyCandidateFiles: setApiKey retires
 * that list, and retiring the rollback would defeat its only purpose. */
export function archivedApiKeyFiles(provider: AiProvider): string[] {
  const dir = lockedArchiveDir();
  const prefix = `ai_key_${provider}-`;
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.bin'))
      .sort()
      .reverse()
      .map((name) => path.join(dir, name));
  } catch {
    return []; // nothing was ever archived
  }
}

function archiveEncryptedFile(file: string): void {
  const contents = fs.readFileSync(file);
  if (contents.toString('utf8').startsWith('b64:')) return;
  const archiveDir = lockedArchiveDir();
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sourceHint = Buffer.from(path.dirname(file)).toString('base64url').slice(-8);
  const target = path.join(archiveDir, `${path.basename(file, '.bin')}-${stamp}-${sourceHint}.bin`);
  fs.writeFileSync(target, contents, { flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch { /* best effort on Windows */ }
}

function retireHistoricalFile(file: string): void {
  try {
    archiveEncryptedFile(file);
    fs.unlinkSync(file);
  } catch {
    // The verified canonical key remains available; retry cleanup next time.
  }
}

export type ApiKeyStorageState = 'available' | 'locked' | 'missing';

export function apiKeyStorageState(provider: AiProvider): ApiKeyStorageState {
  if (getApiKey(provider) !== null) return 'available';
  const blobs = [...apiKeyCandidateFiles(provider), ...archivedApiKeyFiles(provider)];
  return blobs.length > 0 ? 'locked' : 'missing';
}

export function lockedApiKeyProviders(): AiProvider[] {
  return PROVIDERS.filter((provider) => apiKeyStorageState(provider) === 'locked');
}

// ── Cloud audio-provider keys ────────────────────────────────────────────────
// Keys for cloud text-to-speech providers (e.g. Hume) live alongside the AI keys,
// encrypted-at-rest via safeStorage, per vault, and never cross IPC to the UI
// (the renderer only learns whether a key exists).

function audioKeyFile(name: string): string {
  return path.join(activeVaultDir(), `audio_key_${name}.bin`);
}

export function setAudioKey(name: string, key: string): void {
  const clean = key.trim();
  if (!clean) {
    clearAudioKey(name);
    return;
  }
  const file = audioKeyFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(clean));
}

export function getAudioKey(name: string): string | null {
  return readKeyFile(audioKeyFile(name));
}

export function hasAudioKey(name: string): boolean {
  return getAudioKey(name) !== null;
}

export function clearAudioKey(name: string): void {
  const file = audioKeyFile(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Master backup password ───────────────────────────────────────────────────
// One user-chosen password encrypts every automatic backup. It is app-global, not
// vault-local: changing vault must never pause the user's recovery policy. Older
// builds stored it beside the active vault DB; getBackupPassword promotes that file
// once so existing users keep their password without reconfiguration.

function backupPasswordFile(): string {
  return path.join(globalSecretsDir(), 'backup_password.bin');
}

function backupRecoveryKeyFile(): string {
  return path.join(globalSecretsDir(), 'backup_recovery_key.bin');
}

function legacyBackupPasswordFile(): string {
  return path.join(activeVaultDir(), 'backup_password.bin');
}

export function setBackupPassword(password: string): void {
  const clean = password.trim();
  if (!clean) {
    clearBackupPassword();
    return;
  }
  const file = backupPasswordFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(clean));
}

export function getBackupPassword(): string | null {
  const global = readKeyFile(backupPasswordFile());
  if (global !== null) return global;
  try {
    const legacy = readKeyFile(legacyBackupPasswordFile());
    if (legacy !== null) {
      setBackupPassword(legacy);
      return legacy;
    }
  } catch {
    /* no active vault yet */
  }
  return null;
}

export function hasBackupPassword(): boolean {
  return getBackupPassword() !== null;
}

export function clearBackupPassword(): void {
  const file = backupPasswordFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Sync passphrase ──────────────────────────────────────────────────────────
// Sync packages are encrypted, and unlike a one-off export this is a RECURRENT
// operation: a fresh random key per export would mean copying a new secret every single
// time, which nobody sustains. So the user sets one passphrase and types it on both
// machines.
//
// Deliberately NOT the backup master password: restoring with the recovery key mints a
// new random master password, so two machines would silently end up with different ones
// and sync would fail for no visible reason.

function syncPassphraseFile(): string {
  return path.join(globalSecretsDir(), 'sync_passphrase.bin');
}

export function setSyncPassphrase(passphrase: string): void {
  const clean = passphrase.trim();
  if (!clean) {
    clearSyncPassphrase();
    return;
  }
  const file = syncPassphraseFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(clean));
}

export function getSyncPassphrase(): string | null {
  return readKeyFile(syncPassphraseFile());
}

export function hasSyncPassphrase(): boolean {
  return getSyncPassphrase() !== null;
}

export function clearSyncPassphrase(): void {
  const file = syncPassphraseFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── OpenAI Secure MCP Tunnel runtime key ───────────────────────────────────
// This is deliberately separate from the user's OpenAI model-provider key. It is an
// organization-scoped runtime credential whose only job is to poll one Secure MCP
// Tunnel. It is app-global, never returned to the renderer, and is not part of backups.

function mcpTunnelApiKeyFile(): string {
  return path.join(globalSecretsDir(), 'mcp_tunnel_api_key.bin');
}

export function setMcpTunnelApiKey(apiKey: string): void {
  const clean = apiKey.trim();
  if (!clean) {
    clearMcpTunnelApiKey();
    return;
  }
  const file = mcpTunnelApiKeyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeSecretAtomically(
    file,
    safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(clean)
      : Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`),
  );
}

export function getMcpTunnelApiKey(): string | null {
  return readKeyFile(mcpTunnelApiKeyFile());
}

export function hasMcpTunnelApiKey(): boolean {
  return getMcpTunnelApiKey() !== null;
}

export function clearMcpTunnelApiKey(): void {
  const file = mcpTunnelApiKeyFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Local server administrator password ────────────────────────────────────
// Basic mode runs Nodus Server on this computer, and that server needs an administrator
// account for its web administration. Nodus generates the password rather than asking for
// one — nobody should have to invent a password for a service they did not know they were
// installing — so it has to be kept somewhere the user can be shown it again. App-global,
// like the server it belongs to: the process is one per machine, not one per vault.

function localServerAdminPasswordFile(): string {
  return path.join(globalSecretsDir(), 'local_server_admin.bin');
}

export function setLocalServerAdminPassword(password: string): void {
  const clean = password.trim();
  if (!clean) {
    clearLocalServerAdminPassword();
    return;
  }
  const file = localServerAdminPasswordFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeSecretAtomically(
    file,
    safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(clean)
      : Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`),
  );
}

export function getLocalServerAdminPassword(): string | null {
  return readKeyFile(localServerAdminPasswordFile());
}

export function clearLocalServerAdminPassword(): void {
  const file = localServerAdminPasswordFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Nodus Server device token ──────────────────────────────────────────────
// A shared-server pairing grants one vault permission to publish into one remote
// space. Keep that credential beside the vault and OS-encrypted: unlike the public
// server URL/space id it must never enter settings JSON, backups, sync packages or the
// renderer. This is intentionally unrelated to the localhost MCP bearer token.

// The device token lives beside its vault, not beside the active one: a vault stays
// paired and keeps publishing in the background even while a different vault is open,
// so every accessor is keyed by vaultId. The active-vault wrappers below just resolve
// the current vault and delegate here.
function nodusServerTokenFileForDir(dir: string): string {
  return path.join(dir, 'nodus_server_token.bin');
}

function activeVaultIdOrNull(): string | null {
  try { return getActiveVault().id; } catch { return null; }
}

// If the OS keychain is unavailable, keep the publisher credential only for the
// lifetime of this process, per vault. Persisting a reversible base64 token would turn a
// local file read into remote publishing access. The user can pair again after
// restarting once a supported keychain is available.
const transientNodusServerTokens = new Map<string, string>();

export function setNodusServerTokenFor(vaultId: string, value: string): void {
  const clean = value.trim();
  if (!clean) {
    clearNodusServerTokenFor(vaultId);
    return;
  }
  const dir = vaultDir(vaultId);
  if (!dir) return;
  const file = nodusServerTokenFileForDir(dir);
  if (!safeStorage.isEncryptionAvailable()) {
    transientNodusServerTokens.set(vaultId, clean);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeSecretAtomically(file, safeStorage.encryptString(clean));
  transientNodusServerTokens.delete(vaultId);
}

export function getNodusServerTokenFor(vaultId: string): string | null {
  const transient = transientNodusServerTokens.get(vaultId);
  if (transient !== undefined) return transient;
  const dir = vaultDir(vaultId);
  if (!dir) return null;
  try { return readKeyFile(nodusServerTokenFileForDir(dir)); } catch { return null; }
}

export function hasNodusServerTokenFor(vaultId: string): boolean {
  return getNodusServerTokenFor(vaultId) !== null;
}

export function clearNodusServerTokenFor(vaultId: string): void {
  transientNodusServerTokens.delete(vaultId);
  const dir = vaultDir(vaultId);
  if (!dir) return;
  try {
    const file = nodusServerTokenFileForDir(dir);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch { /* the vault directory is gone */ }
}

// Active-vault convenience wrappers. Pairing always targets the currently open vault.
export function setNodusServerToken(value: string): void {
  const id = activeVaultIdOrNull();
  if (id) setNodusServerTokenFor(id, value);
}

export function getNodusServerToken(): string | null {
  const id = activeVaultIdOrNull();
  return id ? getNodusServerTokenFor(id) : null;
}

export function hasNodusServerToken(): boolean {
  return getNodusServerToken() !== null;
}

export function clearNodusServerToken(): void {
  const id = activeVaultIdOrNull();
  if (id) clearNodusServerTokenFor(id);
}

// ── Direct Cloudflare deployment ──────────────────────────────────────────
// Nodus never receives a Cloudflare API/OAuth credential. During the official
// Deploy to Cloudflare flow it creates one random bootstrap secret per vault,
// stores the secret here, and asks the user to paste only its SHA-256 verifier
// into Cloudflare. The secret is deleted as soon as the Worker is connected.
const transientCloudflareBootstrapSecrets = new Map<string, string>();

function cloudflareBootstrapSecretFile(vaultId: string): string | null {
  const dir = vaultDir(vaultId);
  return dir ? path.join(dir, 'cloudflare_bootstrap_secret.bin') : null;
}

export function setCloudflareBootstrapSecret(vaultId: string, value: string): void {
  const clean = value.trim();
  const file = cloudflareBootstrapSecretFile(vaultId);
  if (!clean || !file) { clearCloudflareBootstrapSecret(vaultId); return; }
  if (!safeStorage.isEncryptionAvailable()) {
    transientCloudflareBootstrapSecrets.set(vaultId, clean);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeSecretAtomically(file, safeStorage.encryptString(clean));
  transientCloudflareBootstrapSecrets.delete(vaultId);
}

export function getCloudflareBootstrapSecret(vaultId: string): string | null {
  const transient = transientCloudflareBootstrapSecrets.get(vaultId);
  if (transient !== undefined) return transient;
  const file = cloudflareBootstrapSecretFile(vaultId);
  if (!file) return null;
  try { return readKeyFile(file); } catch { return null; }
}

export function clearCloudflareBootstrapSecret(vaultId: string): void {
  transientCloudflareBootstrapSecrets.delete(vaultId);
  const file = cloudflareBootstrapSecretFile(vaultId);
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
}

/** Remove credentials written by unreleased/legacy OAuth builds. */
export function clearLegacyCloudflareAuthorization(): void {
  const file = path.join(globalSecretsDir(), 'cloudflare_oauth.bin');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const transientCloudflareRecoveryKeys = new Map<string, string>();

function cloudflareRecoveryKeyFile(vaultId: string): string | null {
  const dir = vaultDir(vaultId);
  return dir ? path.join(dir, 'cloudflare_recovery_key.bin') : null;
}

export function setCloudflareRecoveryKey(vaultId: string, value: string): void {
  const clean = value.trim(); const file = cloudflareRecoveryKeyFile(vaultId);
  if (!clean || !file) return;
  if (!safeStorage.isEncryptionAvailable()) { transientCloudflareRecoveryKeys.set(vaultId, clean); if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true }); writeSecretAtomically(file, safeStorage.encryptString(clean));
  transientCloudflareRecoveryKeys.delete(vaultId);
}

export function getCloudflareRecoveryKey(vaultId: string): string | null {
  const transient = transientCloudflareRecoveryKeys.get(vaultId); if (transient) return transient;
  const file = cloudflareRecoveryKeyFile(vaultId); if (!file) return null;
  try { return readKeyFile(file); } catch { return null; }
}

export function setBackupRecoveryKey(recoveryKey: string): void {
  const clean = recoveryKey.trim();
  if (!clean) {
    clearBackupRecoveryKey();
    return;
  }
  const file = backupRecoveryKeyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(clean));
}

export function getBackupRecoveryKey(): string | null {
  return readKeyFile(backupRecoveryKeyFile());
}

export function clearBackupRecoveryKey(): void {
  const file = backupRecoveryKeyFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Map of provider -> whether a key is stored, for the renderer (no keys exposed). */
export function providerKeyMap(): Record<AiProvider, boolean> {
  return Object.fromEntries(AI_PROVIDERS.map((p) => [p, p === 'codex' || p === 'github-copilot' ? false : hasApiKey(p)])) as Record<AiProvider, boolean>;
}

/** Providers with a configured key. Keys are shared globally, so the vault id is
 *  ignored — every vault sees the same providers. */
export function listApiKeyProvidersForVault(_vaultId?: string): AiProvider[] {
  return PROVIDERS.filter((provider) => getApiKey(provider) !== null);
}

/** No-op kept for compatibility: keys are already shared across every vault, so there
 *  is nothing to copy. Returns the providers available to both. */
export function copyApiKeysBetweenVaults(_sourceVaultId: string, _targetVaultId: string): AiProvider[] {
  return listApiKeyProvidersForVault();
}
