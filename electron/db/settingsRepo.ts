import { getDb } from './database';
import { DEFAULT_APP_SETTINGS as DEFAULTS, DEFAULT_LOCAL_PROVIDERS } from '@shared/defaultAppSettings';
import type { AppSettings, ModelRef } from '@shared/types';
import {
  DEFAULT_EMBEDDING_MODELS,
  normalizeCustomProviderConfig,
  normalizeEmbeddingProvider,
} from '@shared/providers';
import { isOpenAiStudySttModel } from '@shared/sttModels';
import { normalizeNodiScale } from '@shared/nodiSize';
import { lockedApiKeyProviders, providerKeyMap } from '../secrets/secretStore';
import { GRANULAR_MODEL_KEYS, migrateModelSettings } from '@shared/modelSettings';
import { DEFAULT_NODUS_IMAGE_QUALITY, isNodusImageQuality } from '@shared/localImageModels';
import { sanitizeCustomEventTypes } from '@shared/eventTypes';
import { sanitizeCustomThemes } from '@shared/appThemes';
import { isPipelineLogMaxEntries, isPipelineLogRetention } from '@shared/pipelineLogs';
import { normalizeToolkitToolPages } from '@shared/toolkitNavigation';
import { migrateScriptorSidebar } from '../../shared/scriptorNavigation.mjs';
import { isResearchEffort } from '@shared/researchReasoning';
import { recoverV23SharedModelPrefs, recoverV23VaultEmbeddingSelection } from './modelPrefsRecovery';
import {
  SHARED_APPEARANCE_KEYS,
  SHARED_MODEL_KEYS,
  isSharedAppearanceKey,
  readGlobalPrefs,
  sharesAppThemeAcrossVaults,
  sharedKeysFor,
  splitGlobalPatch,
  writeGlobalPrefs,
  type SharedModelKey,
} from './appPrefs';

function sanitizeCodexReasoningEfforts(value: unknown): AppSettings['codexReasoningEfforts'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      // The official protocol intentionally leaves effort extensible. Accept a small,
      // identifier-shaped value here; the live model catalog validates support again.
      .filter(([model, effort]) => model.trim().length > 0 && /^[a-z][a-z0-9_-]{0,31}$/.test(String(effort)))
  ) as AppSettings['codexReasoningEfforts'];
}

/**
 * The Research composer's memory of the level it last used per `provider:model`.
 *
 * Only levels this build still knows survive: the map comes from a preferences file the user
 * can edit and outlives app versions that may have renamed or dropped a level. The model half
 * of the key stays free-form, because a custom endpoint's ids are whatever its gateway calls
 * them. Standard is kept like any other level: a model with no entry opens on its middle
 * level, so Standard is a choice the user made (see `withResearchEffort`).
 */
function sanitizeResearchEffortByModel(value: unknown): AppSettings['researchEffortByModel'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, effort]) =>
      /^[a-z][a-z0-9-]{0,31}:.{1,200}$/.test(key) && isResearchEffort(effort))
  ) as AppSettings['researchEffortByModel'];
}

function sanitizeTranscriptionModel(value: unknown): ModelRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ModelRef>;
  return candidate.provider === 'openai' && isOpenAiStudySttModel(candidate.model)
    ? { provider: 'openai', model: candidate.model.trim() }
    : null;
}



/** A shared model key counts as "configured" when it differs from its factory default,
 *  i.e. the user actually chose something. Only such values are allowed to seed the
 *  shared store, so a fresh vault never locks in empty defaults for the others. */
function isConfiguredModelPref(key: SharedModelKey, value: unknown): boolean {
  if (value == null) return false;
  const fallback = (DEFAULTS as Record<string, unknown>)[key];
  if (typeof value === 'string') return value.trim().length > 0 && value !== fallback;
  return JSON.stringify(value) !== JSON.stringify(fallback);
}

function readRaw(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function writeRaw(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/** This vault's own palette, ignoring whatever the shared store is overlaying. */
function readVaultStoredPalette(): Partial<Pick<AppSettings, 'appTheme' | 'customThemes'>> {
  const raw = readRaw('app');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...(parsed.appTheme === undefined ? {} : { appTheme: parsed.appTheme }),
      ...(parsed.customThemes === undefined ? {} : { customThemes: parsed.customThemes }),
    };
  } catch {
    return {};
  }
}

export function getSettings(): AppSettings {
  const raw = readRaw('app');
  let parsed: Partial<AppSettings> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  const merged = { ...DEFAULTS, ...parsed };
  const scriptorMigration = migrateScriptorSidebar(parsed);
  const { changed: scriptorMigrated, ...scriptorPreferences } = scriptorMigration;
  Object.assign(merged, scriptorPreferences);
  if (scriptorMigrated) writeRaw('app', JSON.stringify({ ...parsed, ...scriptorPreferences }));
  const storedConcurrencyVersion = Number.isInteger(parsed.aiConcurrencyVersion)
    ? Number(parsed.aiConcurrencyVersion)
    : 0;
  const storedConcurrencyMode = parsed.aiConcurrencyMode === 'automatic' || parsed.aiConcurrencyMode === 'manual'
    ? parsed.aiConcurrencyMode
    : null;
  // Automatic is the production default. Version 1 is written whenever the user
  // touches the selector, so an explicit manual choice survives every migration.
  // Profiles from the opt-in implementation (or profiles with neither key) remain
  // version 0 and graduate once to automatic.
  if (storedConcurrencyVersion >= 1 && storedConcurrencyMode) {
    merged.aiConcurrencyMode = storedConcurrencyMode;
    merged.aiConcurrencyVersion = storedConcurrencyVersion;
  } else {
    merged.aiConcurrencyMode = 'automatic';
    merged.aiConcurrencyVersion = 1;
  }
  merged.concurrency = Math.max(1, Math.min(8, Math.trunc(Number(merged.concurrency) || 1)));
  // The browser connector stores one canonical extension origin. Treat malformed or
  // hand-edited values as unpaired so they can never authorize a capability endpoint.
  const browserOrigin = typeof merged.browserConnectorOrigin === 'string'
    ? merged.browserConnectorOrigin.trim().toLowerCase()
    : '';
  merged.browserConnectorOrigin = /^(?:chrome|moz)-extension:\/\/[a-z0-9-]{16,80}$/.test(browserOrigin)
    ? browserOrigin
    : '';
  if (merged.libraryScope !== 'global' && merged.libraryScope !== 'vault') merged.libraryScope = 'vault';
  if (typeof merged.libraryGlobalEnabled !== 'boolean') merged.libraryGlobalEnabled = false;
  if (!Number.isInteger(merged.libraryScopeOnboardingVersion) || merged.libraryScopeOnboardingVersion < 0) {
    merged.libraryScopeOnboardingVersion = 0;
  }
  merged.codexReasoningEfforts = sanitizeCodexReasoningEfforts(parsed.codexReasoningEfforts);
  merged.researchEffortByModel = sanitizeResearchEffortByModel(parsed.researchEffortByModel);
  merged.researchWebSearch = parsed.researchWebSearch === 'off' ? 'off' : 'auto';
  merged.mascotScale = normalizeNodiScale(parsed.mascotScale);
  merged.studyImproveToolbarStyleIds = [...new Set((Array.isArray(merged.studyImproveToolbarStyleIds) ? merged.studyImproveToolbarStyleIds : [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0))].slice(0, 4);
  merged.toolkitPinnedPages = normalizeToolkitToolPages(merged.toolkitPinnedPages);
  merged.customEventTypes = sanitizeCustomEventTypes(parsed.customEventTypes);
  // Pre-2.3 builds called the Transformers.js worker simply "local".
  if ((parsed as { sttProvider?: string }).sttProvider === 'local') merged.sttProvider = 'transformers';
  if (!isNodusImageQuality(merged.imageQuality)) merged.imageQuality = DEFAULT_NODUS_IMAGE_QUALITY;
  if (parsed.studyAiPrivacyMode === undefined && parsed.studyAiLocalOnly) merged.studyAiPrivacyMode = 'local';
  merged.studyAiLocalOnly = merged.studyAiPrivacyMode === 'local';
  if (!['ask', 'always', 'never'].includes(merged.studyKnowledgeAutoProcess)) merged.studyKnowledgeAutoProcess = 'ask';
  // Deep-merge local-provider config so a stored partial (or a newly added
  // provider absent from an older settings blob) keeps its default base URL.
  // Normalise on the way OUT as well as in: a blob written by an older build (or by
  // hand) can carry a trailing slash or duplicate slugs, and every consumer reads
  // this value rather than re-normalising for itself.
  merged.customProvider = normalizeCustomProviderConfig(parsed.customProvider ?? merged.customProvider);
  merged.localProviders = {
    ollama: { ...DEFAULT_LOCAL_PROVIDERS.ollama, ...parsed.localProviders?.ollama },
    lmstudio: { ...DEFAULT_LOCAL_PROVIDERS.lmstudio, ...parsed.localProviders?.lmstudio },
  };
  for (const provider of ['ollama', 'lmstudio'] as const) {
    const local = merged.localProviders[provider];
    if (local.contextMode !== 'manual') {
      local.contextMode = 'auto';
      delete local.manualContextTokens;
    } else if (![4096, 8192, 16384, 32768, 65536, 131072].includes(Number(local.manualContextTokens))) {
      local.manualContextTokens = 16384;
    }
  }
  merged.embeddingProvider = normalizeEmbeddingProvider((parsed as Partial<AppSettings>).embeddingProvider);
  if (!merged.embeddingModel?.trim()) merged.embeddingModel = DEFAULT_EMBEDDING_MODELS[merged.embeddingProvider];
  Object.assign(merged, recoverV23VaultEmbeddingSelection(merged as AppSettings));
  // v1.4.0 and older exposed one global header selector. Preserve that user's
  // choice once by seeding the workload settings, then retire the global value
  // so future selectors cannot affect one another through a hidden fallback.
  const legacyDefault = (parsed as Partial<AppSettings>).defaultModel;
  if (legacyDefault) {
    merged.extractionModel ??= legacyDefault;
    merged.synthesisModel ??= legacyDefault;
    merged.summaryModel ??= legacyDefault;
    merged.fusionModel ??= legacyDefault;
    merged.relationModel ??= legacyDefault;
    merged.defaultModel = null;
    writeRaw('app', JSON.stringify(merged));
  }
  // App-wide preferences (theme, language and favorite models) are shared across every
  // vault: overlay the global store, seeding it once from this vault's value so existing
  // users keep their preferences when the first new vault is created.
  const globalPrefs = recoverV23SharedModelPrefs() as ReturnType<typeof readGlobalPrefs>;
  const seed: Record<string, unknown> = {};
  const sharesAppearance = sharesAppThemeAcrossVaults(globalPrefs as Record<string, unknown>);
  // The palette is never inherited from the profile store: a vault shows a palette
  // because it was chosen there. With sharing off, a vault that never stored one keeps
  // the default, even when the profile still holds a palette from a spell of sharing.
  for (const key of sharedKeysFor(sharesAppearance)) {
    if (globalPrefs[key] === undefined) seed[key] = merged[key];
    else (merged as Record<string, unknown>)[key] = globalPrefs[key];
  }
  // app-prefs.json is user-editable; normalize custom themes after the global
  // overlay so malformed or legacy values can never reach the renderer.
  merged.customThemes = sanitizeCustomThemes(merged.customThemes);
  // The global preferences file is user-editable, so validate the shared size again
  // after it has overlaid the vault defaults.
  merged.mascotScale = normalizeNodiScale(merged.mascotScale);
  // Global preferences are user-editable JSON on disk; discard unknown pin ids.
  merged.toolkitPinnedPages = normalizeToolkitToolPages(merged.toolkitPinnedPages);
  // Fail closed to the v3-safe vault scope if these three values are malformed.
  if (merged.libraryScope !== 'global' && merged.libraryScope !== 'vault') merged.libraryScope = 'vault';
  if (typeof merged.libraryGlobalEnabled !== 'boolean') merged.libraryGlobalEnabled = false;
  if (!Number.isInteger(merged.libraryScopeOnboardingVersion) || merged.libraryScopeOnboardingVersion < 0) {
    merged.libraryScopeOnboardingVersion = 0;
  }
  if (!['none', '7d', '30d', '90d', '1y', 'forever'].includes(merged.browserHistoryRetention)) {
    merged.browserHistoryRetention = DEFAULTS.browserHistoryRetention;
    seed.browserHistoryRetention = merged.browserHistoryRetention;
  }
  if (typeof merged.browserClearHistoryOnClose !== 'boolean') {
    merged.browserClearHistoryOnClose = DEFAULTS.browserClearHistoryOnClose;
    seed.browserClearHistoryOnClose = merged.browserClearHistoryOnClose;
  }
  // Same reasoning as the Browser history above: a hand-edited or corrupted retention value
  // must not reach the pruning code, where an unknown window would mean "delete everything".
  // The language needs no repair here — `resolveTranslation` normalizes an unknown locale to
  // English on every read, and the write path validates it.
  if (!isPipelineLogRetention(merged.pipelineLogRetention)) {
    merged.pipelineLogRetention = DEFAULTS.pipelineLogRetention;
    seed.pipelineLogRetention = merged.pipelineLogRetention;
  }
  if (!isPipelineLogMaxEntries(merged.pipelineLogMaxEntries)) {
    merged.pipelineLogMaxEntries = DEFAULTS.pipelineLogMaxEntries;
    seed.pipelineLogMaxEntries = merged.pipelineLogMaxEntries;
  }
  // Cleanup can delete files, so corrupted or hand-edited global preferences must
  // never be treated as an enabled policy. Repair them to conservative defaults
  // before either the renderer or the background scheduler can observe them.
  if (typeof merged.backupCleanupEnabled !== 'boolean') {
    merged.backupCleanupEnabled = DEFAULTS.backupCleanupEnabled;
    seed.backupCleanupEnabled = merged.backupCleanupEnabled;
  }
  const retentionLimits: Record<AppSettings['backupRetentionUnit'], number> = {
    days: 3650,
    weeks: 520,
    months: 120,
    years: 10,
  };
  if (!Object.hasOwn(retentionLimits, merged.backupRetentionUnit)) {
    merged.backupRetentionUnit = DEFAULTS.backupRetentionUnit;
    seed.backupRetentionUnit = merged.backupRetentionUnit;
  }
  const retentionLimit = retentionLimits[merged.backupRetentionUnit];
  if (!Number.isInteger(merged.backupRetentionValue) || merged.backupRetentionValue < 1 || merged.backupRetentionValue > retentionLimit) {
    merged.backupRetentionValue = DEFAULTS.backupRetentionValue;
    seed.backupRetentionValue = merged.backupRetentionValue;
  }
  if (typeof merged.lastBackupCleanupAt !== 'string' && merged.lastBackupCleanupAt !== null) {
    merged.lastBackupCleanupAt = null;
    seed.lastBackupCleanupAt = null;
  }
  if (typeof merged.lastBackupCleanupStatus !== 'string' && merged.lastBackupCleanupStatus !== null) {
    merged.lastBackupCleanupStatus = null;
    seed.lastBackupCleanupStatus = null;
  }
  // AI model configuration is shared too (API keys already are). Overlay the shared
  // store when it holds a real value; otherwise seed it — but ONLY from a vault that has
  // actually changed a key away from its default, so an unconfigured vault opened first
  // can never overwrite a configured one with empty values. A stored `null` counts as
  // "unset" (not an overlay): otherwise a per-vault value just seeded by the legacy
  // defaultModel migration would be clobbered back to null by the shared store.
  for (const key of SHARED_MODEL_KEYS) {
    if (globalPrefs[key] !== undefined && globalPrefs[key] !== null) {
      (merged as Record<string, unknown>)[key] = globalPrefs[key];
    } else if (isConfiguredModelPref(key, merged[key])) {
      seed[key] = merged[key];
    }
  }
  const safeTranscriptionModel = sanitizeTranscriptionModel(merged.transcriptionModel);
  if (
    safeTranscriptionModel?.provider !== merged.transcriptionModel?.provider
    || safeTranscriptionModel?.model !== merged.transcriptionModel?.model
  ) {
    merged.transcriptionModel = safeTranscriptionModel;
    // Repair stale values written by the old generic model picker. This also
    // prevents another vault from re-seeding the invalid shared preference.
    seed.transcriptionModel = safeTranscriptionModel;
  }
  merged.codexReasoningEfforts = sanitizeCodexReasoningEfforts(merged.codexReasoningEfforts);
  merged.researchEffortByModel = sanitizeResearchEffortByModel(merged.researchEffortByModel);
  merged.researchWebSearch = merged.researchWebSearch === 'off' ? 'off' : 'auto';
  if ((merged.sttProvider as string) === 'local') {
    merged.sttProvider = 'transformers';
    seed.sttProvider = 'transformers';
  }
  const modelMigration = migrateModelSettings(merged, globalPrefs);
  if (modelMigration.changed) {
    Object.assign(merged, modelMigration.settings);
    // Keep a local fallback for the migrated payload. Common capability values
    // (including mode/version) are mirrored through the global preference store.
    const { providerKeys: _providerKeys, lockedProviderKeys: _lockedProviderKeys, ...persisted } = merged as AppSettings;
    writeRaw('app', JSON.stringify(persisted));
    for (const key of SHARED_MODEL_KEYS) {
      if (key in merged) seed[key] = merged[key];
    }
  }
  // Modes are exclusive. Basic mode synchronizes every text task to one model;
  // advanced mode materializes any old empty slot so its picker is always concrete.
  let synchronized = false;
  for (const key of GRANULAR_MODEL_KEYS) {
    const current = merged[key];
    const general = merged.synthesisModel;
    // The reasoning level is part of the selection, so basic mode has to level it too:
    // otherwise a per-task level chosen in advanced mode would keep running invisibly
    // behind the single picker basic mode shows.
    const differsFromGeneral = current?.provider !== general?.provider
      || current?.model !== general?.model
      || current?.reasoningEffort !== general?.reasoningEffort;
    const shouldMaterialize = merged.modelSettingsMode === 'advanced' && current == null && general != null;
    if ((merged.modelSettingsMode === 'basic' && differsFromGeneral) || shouldMaterialize) {
      merged[key] = general;
      synchronized = true;
      if ((SHARED_MODEL_KEYS as readonly string[]).includes(key)) seed[key] = general;
    }
  }
  if (synchronized && !modelMigration.changed) {
    const { providerKeys: _providerKeys, lockedProviderKeys: _lockedProviderKeys, ...persisted } = merged as AppSettings;
    writeRaw('app', JSON.stringify(persisted));
  }
  if (Object.keys(seed).length) writeGlobalPrefs(seed);
  return { ...merged, providerKeys: providerKeyMap(), lockedProviderKeys: lockedApiKeyProviders() };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const previous = getSettings();
  if (patch.academicMode !== undefined) {
    if (patch.academicMode !== 'auto' && patch.academicMode !== 'manual') throw new Error('Invalid academic mode.');
    if (previous.onboardingComplete && patch.academicMode !== (previous.academicMode ?? 'auto')) {
      throw new Error('El modo académico se elige al crear la bóveda.');
    }
    if (patch.academicMode === 'auto' && previous.academicMode === 'manual' && !previous.onboardingComplete) {
      patch = { ...patch, autoLightScan: DEFAULTS.autoLightScan, autoDeepScanOnReadTag: DEFAULTS.autoDeepScanOnReadTag,
        autoSummaryAfterDeep: DEFAULTS.autoSummaryAfterDeep, autoBridgeAfterQueue: DEFAULTS.autoBridgeAfterQueue,
        autoResumeQueue: DEFAULTS.autoResumeQueue, documentIndexingEnabled: DEFAULTS.documentIndexingEnabled };
    }
    if (patch.academicMode === 'manual' && previous.academicMode !== 'manual') {
      patch = { ...patch, embeddingProvider: 'nodus', embeddingModel: DEFAULT_EMBEDDING_MODELS.nodus };
    }
  }
  if ((patch.academicMode ?? previous.academicMode) === 'manual') {
    patch = { ...patch, autoLightScan: false, autoDeepScanOnReadTag: false,
      autoSummaryAfterDeep: false, autoBridgeAfterQueue: false, autoResumeQueue: false, documentIndexingEnabled: false };
  }
  if (patch.browserConnectorOrigin !== undefined) {
    const value = typeof patch.browserConnectorOrigin === 'string'
      ? patch.browserConnectorOrigin.trim().toLowerCase()
      : '';
    patch = {
      ...patch,
      browserConnectorOrigin: /^(?:chrome|moz)-extension:\/\/[a-z0-9-]{16,80}$/.test(value) ? value : '',
    };
  }
  if (patch.mascotScale !== undefined) {
    patch = { ...patch, mascotScale: normalizeNodiScale(patch.mascotScale) };
  }
  if (patch.customEventTypes !== undefined) {
    patch = { ...patch, customEventTypes: sanitizeCustomEventTypes(patch.customEventTypes) };
  }
  if (patch.customProvider !== undefined) {
    // Normalise on the way IN as well as out: the stored blob is what Settings
    // renders back, and a trailing slash the user pasted should not survive to be
    // shown to them (nor to be diffed against the next value they type).
    patch = { ...patch, customProvider: normalizeCustomProviderConfig(patch.customProvider) };
  }
  if (patch.customThemes !== undefined) {
    patch = { ...patch, customThemes: sanitizeCustomThemes(patch.customThemes) };
  }
  if (patch.appTheme !== undefined) {
    patch = { ...patch, appTheme: typeof patch.appTheme === 'string' ? patch.appTheme.trim().toLowerCase() : 'default' };
  }
  if (patch.codexReasoningEfforts !== undefined) {
    patch = { ...patch, codexReasoningEfforts: sanitizeCodexReasoningEfforts(patch.codexReasoningEfforts) };
  }
  if (patch.researchEffortByModel !== undefined) {
    patch = { ...patch, researchEffortByModel: sanitizeResearchEffortByModel(patch.researchEffortByModel) };
  }
  if (patch.studyImproveToolbarStyleIds) {
    patch = { ...patch, studyImproveToolbarStyleIds: [...new Set(patch.studyImproveToolbarStyleIds.filter((value) => typeof value === 'string' && value.trim()))].slice(0, 4) };
  }
  if (patch.toolkitPinnedPages !== undefined) {
    patch = { ...patch, toolkitPinnedPages: normalizeToolkitToolPages(patch.toolkitPinnedPages) };
  }
  if (patch.transcriptionModel !== undefined) {
    patch = { ...patch, transcriptionModel: sanitizeTranscriptionModel(patch.transcriptionModel) };
  }
  if (patch.modelSettingsMode === undefined && GRANULAR_MODEL_KEYS.some((key) => patch[key] != null)) {
    patch = { ...patch, modelSettingsMode: 'advanced' };
  }
  if (patch.studyAiLocalOnly !== undefined && patch.studyAiPrivacyMode === undefined) {
    patch = { ...patch, studyAiPrivacyMode: patch.studyAiLocalOnly ? 'local' : 'hybrid' };
  }
  const current = getSettings();
  const sharesBefore = sharesAppThemeAcrossVaults();
  const sharesAfter = patch.shareAppThemeAcrossVaults ?? sharesBefore;
  // Turning the shared palette on adopts the one on screen: "the same in every vault"
  // has to mean the palette the user is looking at, not whatever the file held last.
  // A palette sent in the same patch is the user naming one explicitly (the new-vault
  // wizard sets the switch and the palette together), so it wins over that adoption.
  if (sharesAfter && !sharesBefore && patch.appTheme === undefined && patch.customThemes === undefined) {
    patch = { ...patch, appTheme: current.appTheme, customThemes: current.customThemes };
  }
  // While the palette is shared — and on the write that stops sharing it — the vault
  // keeps the palette it had. The values on screen come from the shared store, so
  // writing those back would overwrite this vault's own palette, and switching the
  // sharing off could never restore it.
  const vaultOwnedPalette = sharesAfter || sharesBefore ? readVaultStoredPalette() : null;
  // Shared keys (theme/language/favorites + the AI model configuration) go to the global store;
  // everything else stays per-vault. Model keys are also kept in the per-vault blob as a
  // fallback, so switching vaults never loses a value.
  const { global, local } = splitGlobalPatch(patch, sharesAfter);
  if (Object.keys(global).length) writeGlobalPrefs(global);
  // providerKeys is derived from the secret store, never persisted.
  const { providerKeys: _ignore, lockedProviderKeys: _ignoreLocked, ...rest } = { ...current, ...local };
  // Never persist the app-wide keys into the per-vault blob (they'd shadow the
  // shared store and drift), so keep them exclusively in the global prefs file. The
  // palette is exempt either way: it is this vault's own record of what it shows.
  for (const key of sharedKeysFor(sharesAfter)) {
    if (isSharedAppearanceKey(key)) continue;
    delete (rest as Record<string, unknown>)[key];
  }
  if (vaultOwnedPalette) {
    for (const key of SHARED_APPEARANCE_KEYS) {
      if (vaultOwnedPalette[key] === undefined) delete (rest as Record<string, unknown>)[key];
      else (rest as Record<string, unknown>)[key] = vaultOwnedPalette[key];
    }
  }
  writeRaw('app', JSON.stringify(rest));
  return getSettings();
}
