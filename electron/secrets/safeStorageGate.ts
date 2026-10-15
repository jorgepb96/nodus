import fs from 'node:fs';
import { safeStorage as electronSafeStorage } from 'electron';
import type { AiProvider } from '@shared/types';

/**
 * Local test-harness mode (never set by the app itself): NODUS_HARNESS_KEYS_FILE names a JSON
 * file of provider API keys, `{ "deepseek": "…", "anthropic": "…" }`, readable only by the user.
 * In this mode the app never touches the macOS Keychain — a locally re-signed build otherwise
 * asks for the login password on every rebuild, which stops an unattended overnight run — so
 * API keys come from the file, and every other stored secret (plugin secrets, backup and sync
 * passwords) reads as absent, exactly as when the OS credential store is unavailable.
 */
const HARNESS_KEYS_FILE = process.env.NODUS_HARNESS_KEYS_FILE?.trim() || null;

export function harnessKeysMode(): boolean {
  return HARNESS_KEYS_FILE !== null;
}

let harnessKeys: Record<string, string> | null = null;

/** The key for a provider from the harness key file, or null (no file, no entry, unreadable). */
export function harnessApiKey(provider: AiProvider): string | null {
  if (!HARNESS_KEYS_FILE) return null;
  if (!harnessKeys) {
    try {
      const parsed = JSON.parse(fs.readFileSync(HARNESS_KEYS_FILE, 'utf8')) as unknown;
      harnessKeys = parsed && typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, (value as string).trim()])) : {};
    } catch {
      harnessKeys = {};
    }
  }
  return harnessKeys[provider] ?? null;
}

/** Electron's safeStorage, except in harness mode, where encryption reports unavailable and is
 *  never attempted, so no caller reaches the Keychain. */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => (harnessKeysMode() ? false : electronSafeStorage.isEncryptionAvailable()),
  encryptString: (text: string): Buffer => {
    if (harnessKeysMode()) throw new Error('The secure credential store is disabled in harness mode.');
    return electronSafeStorage.encryptString(text);
  },
  decryptString: (data: Buffer): string => {
    if (harnessKeysMode()) throw new Error('The secure credential store is disabled in harness mode.');
    return electronSafeStorage.decryptString(data);
  },
};
