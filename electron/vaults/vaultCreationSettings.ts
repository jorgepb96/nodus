import Database from 'better-sqlite3';
import type { CreateVaultInput, ModelRef } from '@shared/types';
import { MODEL_SETTINGS_VERSION } from '@shared/modelSettings';
import {
  AI_PROVIDERS,
  EMBEDDING_PROVIDERS,
  normalizeEmbeddingModel,
} from '@shared/providers';
import { readGlobalPrefs, writeGlobalPrefs } from '../db/appPrefs';

const VALID_AI_PROVIDERS = new Set([...AI_PROVIDERS, 'nodus']);
const VALID_EMBEDDING_PROVIDERS = new Set(EMBEDDING_PROVIDERS);

export interface ValidatedVaultModelSelection {
  aiModel: ModelRef;
  embeddingProvider: NonNullable<CreateVaultInput['embeddingProvider']>;
  embeddingModel: string;
}

/** Validate the all-or-nothing model payload while keeping old createVault callers
 * valid. The renderer wizard always sends all three fields. */
export function validateVaultModelSelection(input: CreateVaultInput): ValidatedVaultModelSelection | null {
  const hasAnySelection = Boolean(input.aiModel || input.embeddingProvider || input.embeddingModel);
  if (!hasAnySelection) return null;
  const aiModel = input.aiModel;
  if (!aiModel || !VALID_AI_PROVIDERS.has(aiModel.provider) || !aiModel.model.trim()) {
    throw new Error('Elige un modelo de IA válido para crear la bóveda.');
  }
  if (!input.embeddingProvider || !VALID_EMBEDDING_PROVIDERS.has(input.embeddingProvider) || !input.embeddingModel?.trim()) {
    throw new Error('Elige un modelo de embeddings válido para crear la bóveda.');
  }
  return {
    aiModel: { provider: aiModel.provider, model: aiModel.model.trim() },
    embeddingProvider: input.embeddingProvider,
    embeddingModel: normalizeEmbeddingModel(input.embeddingProvider, input.embeddingModel),
  };
}

/** Seed the unopened database and the existing shared text-model preference. The
 * embedding choice remains vault-local; the general AI choice follows Nodus' current
 * app-wide model-sharing contract. */
export function initializeVaultModelSelection(databasePath: string, selection: ValidatedVaultModelSelection): void {
  const shared = readGlobalPrefs();
  const favorites = Array.isArray(shared.favorites) ? [...shared.favorites] : [];
  if (!favorites.some((model) => model.provider === selection.aiModel.provider && model.model === selection.aiModel.model)) {
    favorites.push(selection.aiModel);
  }
  const seeded = {
    embeddingProvider: selection.embeddingProvider,
    embeddingModel: selection.embeddingModel,
    favorites,
    modelSettingsMode: 'basic',
    modelSettingsVersion: MODEL_SETTINGS_VERSION,
    synthesisModel: selection.aiModel,
  };

  const db = new Database(databasePath);
  try {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(seeded));
  } finally {
    db.close();
  }
  writeGlobalPrefs({ favorites, synthesisModel: selection.aiModel });
}

/** Only local vault creation calls this; restores and replicas retain their presentation. */
export function initializeVaultInterfaceProfile(databasePath: string): void {
  const db = new Database(databasePath);
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('app') as { value: string } | undefined;
    const stored = row ? JSON.parse(row.value) : {};
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('app', JSON.stringify({ ...stored, academicInterfaceProfile: 'simple', autoLightScan:false, autoDeepScanOnReadTag:false }));
  } finally { db.close(); }
}
