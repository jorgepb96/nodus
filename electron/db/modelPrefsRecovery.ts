import Database from 'better-sqlite3';
import type { AppSettings, ModelRef } from '@shared/types';
import { normalizeEmbeddingProvider } from '@shared/providers';
import { getDb } from './database';
import { readGlobalPrefsRaw, writeGlobalPrefsRaw } from './appPrefs';
import { listVaults } from '../vaults/vaultRegistry';

const RECOVERY_MARKER = 'v23ModelPrefsRecoveryVersion';
const RECOVERY_VERSION = 1;

interface EmbeddingSignature {
  provider: AppSettings['embeddingProvider'];
  model: string;
  count: number;
}

function modelRef(value: unknown): ModelRef | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ModelRef>;
  if (typeof candidate.provider !== 'string' || !candidate.provider.trim()) return null;
  if (typeof candidate.model !== 'string' || !candidate.model.trim()) return null;
  return { provider: candidate.provider as ModelRef['provider'], model: candidate.model };
}

function addFavorites(target: ModelRef[], seen: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const ref = modelRef(item);
    if (!ref) continue;
    const key = `${ref.provider}\u0000${ref.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(ref);
  }
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readVaultSettings(db: Database.Database): Partial<AppSettings> {
  let settings: Partial<AppSettings> = {};
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
  if (row) {
    try {
      settings = JSON.parse(row.value) as Partial<AppSettings>;
    } catch {
      /* A malformed vault must not prevent recovery from the other readable vaults. */
    }
  }

  return settings;
}

function readEmbeddingSignatures(db: Database.Database): EmbeddingSignature[] {
  const signatures: EmbeddingSignature[] = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const columns = new Set((db.pragma(`table_info(${quotedIdentifier(name)})`) as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has('embedding') || !columns.has('embedding_provider') || !columns.has('embedding_model')) continue;
    const table = quotedIdentifier(name);
    const rows = db.prepare(`
      SELECT embedding_provider AS provider, embedding_model AS model, COUNT(*) AS count
      FROM ${table}
      WHERE embedding IS NOT NULL AND embedding_provider IS NOT NULL AND embedding_model IS NOT NULL
      GROUP BY embedding_provider, embedding_model
    `).all() as Array<{ provider: string; model: string; count: number }>;
    for (const item of rows) {
      if (!item.provider?.trim() || !item.model?.trim() || item.count <= 0) continue;
      signatures.push({ provider: normalizeEmbeddingProvider(item.provider), model: item.model, count: item.count });
    }
  }
  return signatures;
}

function consolidatedSignatures(db: Database.Database): Map<string, EmbeddingSignature> {
  const signatures = new Map<string, EmbeddingSignature>();
  for (const signature of readEmbeddingSignatures(db)) {
    const key = `${signature.provider}\u0000${signature.model}`;
    const prior = signatures.get(key);
    if (prior) prior.count += signature.count;
    else signatures.set(key, { ...signature });
  }
  return signatures;
}

/** Restore the selection for ONE vault from its own vector metadata. The model
 * settings migration version is the one-shot guard: after v3, later deliberate
 * changes are never reverted even while older vectors still exist. */
export function recoverV23VaultEmbeddingSelection(settings: AppSettings): Partial<AppSettings> {
  if (getDb().prepare("SELECT 1 FROM sqlite_master WHERE name='embedding_index_state'").get()) return {};
  if (settings.modelSettingsVersion >= 3) return {};
  const signatures = consolidatedSignatures(getDb());
  if (signatures.size !== 1) return {};
  const [detected] = signatures.values();
  const selectedProvider = normalizeEmbeddingProvider(settings.embeddingProvider);
  const selectedKey = `${selectedProvider}\u0000${settings.embeddingModel ?? ''}`;
  if (signatures.has(selectedKey)) return {};
  return { embeddingProvider: detected.provider, embeddingModel: detected.model };
}

/**
 * One-shot repair for the 2.3 preference migration. It never edits embeddings or
 * vault databases: it only reconstructs the global favorites from surviving local
 * fallbacks. Embedding selection is recovered per vault because every vault owns a
 * separate vector index and may legitimately use a different model.
 */
export function recoverV23SharedModelPrefs(): Record<string, unknown> {
  const current = readGlobalPrefsRaw();
  if (Number(current[RECOVERY_MARKER] ?? 0) >= RECOVERY_VERSION) return current;

  const favorites: ModelRef[] = [];
  const favoriteKeys = new Set<string>();
  addFavorites(favorites, favoriteKeys, current.favorites);
  let complete = true;

  for (const vault of listVaults()) {
    let db: Database.Database | null = null;
    let close = false;
    try {
      db = vault.active ? getDb() : new Database(vault.path, { readonly: true, fileMustExist: true });
      close = !vault.active;
      addFavorites(favorites, favoriteKeys, readVaultSettings(db).favorites);
    } catch {
      complete = false;
    } finally {
      if (close) db?.close();
    }
  }

  const patch: Record<string, unknown> = {};
  if (JSON.stringify(favorites) !== JSON.stringify(current.favorites ?? [])) patch.favorites = favorites;

  // If a vault was temporarily unreadable, retry next launch so no favorite is left
  // behind. Applied patches are merge-only and therefore safe to repeat.
  if (complete) patch[RECOVERY_MARKER] = RECOVERY_VERSION;
  if (Object.keys(patch).length > 0) writeGlobalPrefsRaw(patch);
  return { ...current, ...patch };
}
