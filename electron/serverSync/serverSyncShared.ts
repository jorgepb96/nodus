import Database from 'better-sqlite3';
import { getSettings } from '../db/settingsRepo';
import { hasNodusServerTokenFor } from '../secrets/secretStore';
import { listVaults } from '../vaults/vaultRegistry';
import type { AppLanguage, AppSettings, VaultSummary } from '@shared/types';
import type { NodusServerKind } from '@shared/cloudflare';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import { requestTimeoutMs } from './serverNetwork';

/**
 * What both halves of the Nodus Server conversation need: where the server is, how to ask
 * it something, and what this vault has been configured to do.
 *
 * It exists because there are now two independent readers of that configuration — the
 * publisher, which sends a snapshot on a debounce, and the inbox poller, which drains the
 * mutation ledger on a fixed timer. Neither is a sub-part of the other, so neither should
 * be reaching into the other's module for a URL parser.
 */

export function normalizeUrl(value: string): string {
  const clean = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(clean); } catch { throw new Error('Introduce una URL válida del servidor.'); }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Nodus Server necesita HTTPS fuera de localhost.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Usa solo la dirección base del servidor, sin credenciales, parámetros ni fragmentos.');
  return parsed.toString().replace(/\/+$/, '');
}

export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  // Scaled by the body: a snapshot PUT of tens of MiB is not a sixty-second request.
  return fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs(init)) });
}

// ── Per-vault configuration reads ───────────────────────────────────────────
// The server URL/space/flags live in each vault's own settings blob (per-vault, not
// global). The active vault is read through the live connection; siblings are read
// through a cached read-only handle, exactly like cross-vault relation lookups.

export interface VaultServerConfig {
  vaultId: string;
  vaultName: string;
  vaultType: VaultSummary['type'];
  isActiveVault: boolean;
  kind: NodusServerKind;
  url: string;
  spaceId: string;
  spaceName: string;
  language: AppLanguage;
  enabled: boolean;
  autoSync: boolean;
  includeUserContent: boolean;
  includePassages: boolean;
  includeLibraryDocuments: boolean;
  includeVectors: boolean;
  /** New projections remain off unless a future settings surface explicitly opts in. */
  includePrimarySources: boolean;
  includeTestimonies: boolean;
  includePersonalImports: boolean;
  hasToken: boolean;
  configured: boolean;
}

const readonlyPool = new Map<string, Database.Database>();

export function openReadOnly(dbPath: string): Database.Database | null {
  const cached = readonlyPool.get(dbPath);
  if (cached) {
    try { cached.prepare('SELECT 1').get(); return cached; }
    catch { readonlyPool.delete(dbPath); }
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    readonlyPool.set(dbPath, db);
    return db;
  } catch { return null; }
}

export function closeReadOnlyPool(): void {
  for (const db of readonlyPool.values()) { try { db.close(); } catch { /* ignore */ } }
  readonlyPool.clear();
}

function readSiblingServerBlob(vaultPath: string): Partial<AppSettings> {
  const db = openReadOnly(vaultPath);
  if (!db) return {};
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    if (!row?.value) return {};
    return JSON.parse(row.value) as Partial<AppSettings>;
  } catch { return {}; }
}

function toConfig(vault: VaultSummary, blob: Partial<AppSettings>): VaultServerConfig {
  const extended = blob as Partial<AppSettings> & Record<string, unknown>;
  const url = String(blob.nodusServerUrl || '');
  const spaceId = String(blob.nodusServerSpaceId || '');
  const hasToken = hasNodusServerTokenFor(vault.id);
  return {
    vaultId: vault.id,
    vaultName: vault.name,
    vaultType: vault.type,
    isActiveVault: vault.active,
    kind: blob.nodusServerKind === 'cloudflare' ? 'cloudflare' : 'classic',
    url,
    spaceId,
    spaceName: String(blob.nodusServerSpaceName || ''),
    language: normalizeUiLanguage((blob.nodusServerLanguage as AppLanguage) ?? 'en'),
    enabled: Boolean(blob.nodusServerEnabled),
    autoSync: blob.nodusServerAutoSync !== false,
    includeUserContent: Boolean(blob.nodusServerIncludeUserContent),
    includePassages: Boolean(blob.nodusServerIncludePassages),
    includeLibraryDocuments: Boolean(blob.nodusServerIncludeLibraryDocuments),
    includeVectors: blob.nodusServerIncludeVectors !== false,
    includePrimarySources: extended.nodusServerIncludePrimarySources === true,
    includeTestimonies: extended.nodusServerIncludeTestimonies === true,
    includePersonalImports: extended.nodusServerIncludePersonalImports !== false,
    hasToken,
    configured: Boolean(url && spaceId && hasToken),
  };
}

export function readVaultConfig(vault: VaultSummary): VaultServerConfig {
  if (vault.active) {
    const s = getSettings();
    return toConfig(vault, {
      nodusServerUrl: s.nodusServerUrl,
      nodusServerKind: s.nodusServerKind,
      nodusServerSpaceId: s.nodusServerSpaceId,
      nodusServerSpaceName: s.nodusServerSpaceName,
      nodusServerLanguage: s.nodusServerLanguage,
      nodusServerEnabled: s.nodusServerEnabled,
      nodusServerAutoSync: s.nodusServerAutoSync,
      nodusServerIncludeUserContent: s.nodusServerIncludeUserContent,
      nodusServerIncludePassages: s.nodusServerIncludePassages,
      nodusServerIncludePrimarySources: s.nodusServerIncludePrimarySources,
      nodusServerIncludeTestimonies: s.nodusServerIncludeTestimonies,
      nodusServerIncludeLibraryDocuments: s.nodusServerIncludeLibraryDocuments,
      nodusServerIncludeVectors: s.nodusServerIncludeVectors,
    });
  }
  // A sibling connection always has a device token, so skip opening its database (and
  // caching a read-only handle to it) when there is none — most vaults are not shared.
  if (!hasNodusServerTokenFor(vault.id)) return toConfig(vault, {});
  return toConfig(vault, readSiblingServerBlob(vault.path));
}

export function listVaultConfigs(): VaultServerConfig[] {
  let vaults: VaultSummary[] = [];
  try { vaults = listVaults(); } catch { vaults = []; }
  return vaults.map((vault) => readVaultConfig(vault));
}
