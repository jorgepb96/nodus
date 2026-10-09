import { safeStorage } from './safeStorageGate';
import { spawn } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import fs from 'node:fs';
import type { AiProvider } from '@shared/types';
import { lockedApiKeyProviders, apiKeyCandidateFiles, archivedApiKeyFiles, getApiKey, setApiKey } from './secretStore';

const KEYCHAIN_TIMEOUT_MS = 120_000;
const STORAGE_NAMES = ['nodus', 'Nodus'] as const;
const CHROMIUM_V10_PREFIX = Buffer.from('v10');
const CHROMIUM_SALT = Buffer.from('saltysalt');
const CHROMIUM_IV = Buffer.alloc(16, 0x20);

export interface ApiKeyRecoveryResult {
  recoveredProviders: AiProvider[];
  remainingLockedProviders: AiProvider[];
}

type CredentialRunner = (
  storageName: (typeof STORAGE_NAMES)[number],
  candidates: Partial<Record<AiProvider, string[]>>
) => Promise<Partial<Record<AiProvider, string>>>;

function validSecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

/** Compatibility decoder for Electron/Chromium's macOS v10 Safe Storage
 * format. It is deliberately limited to the exact historical format Nodus
 * wrote: PBKDF2-HMAC-SHA1 (1003 rounds) and AES-128-CBC with a space IV. */
export function decryptChromiumV10Blob(blob: Buffer, keychainPassword: Buffer): string | null {
  if (blob.length <= CHROMIUM_V10_PREFIX.length || !blob.subarray(0, 3).equals(CHROMIUM_V10_PREFIX)) return null;
  const key = pbkdf2Sync(keychainPassword, CHROMIUM_SALT, 1003, 16, 'sha1');
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, CHROMIUM_IV);
    const plaintext = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]).toString('utf8');
    return validSecret(plaintext) ? plaintext : null;
  } catch {
    return null;
  } finally {
    key.fill(0);
  }
}

/** Ask macOS for the released app's Safe Storage password. The password is
 * captured through an anonymous pipe, never placed in argv/env/logs, bounded in
 * memory and zeroed immediately after the candidate blobs have been tried. */
function readKeychainPassword(storageName: (typeof STORAGE_NAMES)[number]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/security', [
      'find-generic-password',
      '-w',
      '-s', `${storageName} Safe Storage`,
      '-a', `${storageName} Key`,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (password: Buffer | null) => {
      if (settled) {
        password?.fill(0);
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(password);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(null);
    }, KEYCHAIN_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 64 * 1024) chunks.push(Buffer.from(chunk));
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0 || size === 0 || size > 64 * 1024) return finish(null);
      const output = Buffer.concat(chunks);
      let end = output.length;
      while (end > 0 && (output[end - 1] === 0x0a || output[end - 1] === 0x0d)) end -= 1;
      if (end === 0) return finish(null);
      const password = Buffer.from(output.subarray(0, end));
      output.fill(0);
      finish(password);
    });
  });
}

async function recoverWithKeychainCredential(
  storageName: (typeof STORAGE_NAMES)[number],
  candidates: Partial<Record<AiProvider, string[]>>
): Promise<Partial<Record<AiProvider, string>>> {
  const password = await readKeychainPassword(storageName);
  if (!password) return {};
  try {
    const keys: Partial<Record<AiProvider, string>> = {};
    for (const [provider, files] of Object.entries(candidates) as [AiProvider, string[]][]) {
      for (const file of files) {
        try {
          const value = decryptChromiumV10Blob(fs.readFileSync(file), password);
          if (value) {
            keys[provider] = value;
            break;
          }
        } catch {
          // Keep trying the other released storage locations.
        }
      }
    }
    return keys;
  } finally {
    password.fill(0);
  }
}

let recoveryInFlight: Promise<ApiKeyRecoveryResult> | null = null;

export function recoverLegacyApiKeys(
  runCredentialRecovery: CredentialRunner = recoverWithKeychainCredential,
  platform: NodeJS.Platform = process.platform
): Promise<ApiKeyRecoveryResult> {
  if (runCredentialRecovery !== recoverWithKeychainCredential || platform !== process.platform) {
    return performLegacyApiKeyRecovery(runCredentialRecovery, platform);
  }
  if (recoveryInFlight) return recoveryInFlight;
  recoveryInFlight = performLegacyApiKeyRecovery(runCredentialRecovery, platform).finally(() => { recoveryInFlight = null; });
  return recoveryInFlight;
}

async function performLegacyApiKeyRecovery(
  runCredentialRecovery: CredentialRunner,
  platform: NodeJS.Platform
): Promise<ApiKeyRecoveryResult> {
  if (platform !== 'darwin') {
    return { recoveredProviders: [], remainingLockedProviders: lockedApiKeyProviders() };
  }
  const recovered = new Set<AiProvider>();
  for (const storageName of STORAGE_NAMES) {
    const pending = lockedApiKeyProviders();
    if (pending.length === 0) break;
    // The emergency archive is included: a blob that only survives there is
    // exactly the case this recovery exists for.
    const candidates = Object.fromEntries(pending.map((provider) => [
      provider,
      [...apiKeyCandidateFiles(provider), ...archivedApiKeyFiles(provider)],
    ])) as Partial<Record<AiProvider, string[]>>;
    const keys = await runCredentialRecovery(storageName, candidates);
    for (const provider of pending) {
      const key = keys[provider];
      if (!validSecret(key) || !safeStorage.isEncryptionAvailable()) continue;
      try {
        setApiKey(provider, key);
        if (getApiKey(provider) === key) recovered.add(provider);
      } catch {
        // The original encrypted candidates remain untouched and can be retried.
      }
    }
  }
  return {
    recoveredProviders: [...recovered],
    remainingLockedProviders: lockedApiKeyProviders(),
  };
}
