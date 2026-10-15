import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '@shared/types';

// App-wide preferences that must be the SAME in every vault (not per-vault). Two
// families live here, both persisted in a single JSON in userData so that creating
// or switching vaults never resets them:
//
//  • GLOBAL_PREF_KEYS   — theme/interface preferences, model favorites and the
//                         recovery policy. Always present, so the first vault read
//                         seeds them unconditionally.
//  • SHARED_MODEL_KEYS  — the AI model configuration (every workload selector,
//                         local-provider base URLs and the image model).
//                         API keys are already shared across vaults, so the models
//                         chosen for them should travel too. These are seeded only
//                         from a vault that has actually configured them (see
//                         settingsRepo), so an unconfigured vault opened first can
//                         never lock in empty defaults for a configured one.
//  • SHARED_APPEARANCE_KEYS — the colour palette and the custom theme definitions.
//                         These are global ONLY while shareAppThemeAcrossVaults is
//                         on; by default each vault keeps its own palette, so the
//                         keys are listed separately and resolved per read rather
//                         than baked into GLOBAL_PREF_KEYS. The switch itself is
//                         always global: a policy that changed per vault would
//                         contradict the thing it configures.
//
// Everything else in AppSettings stays per-vault (including granular feature/task
// overrides, monitored collections and vault onboarding flags).

export const GLOBAL_PREF_KEYS = [
  'academicLearningProgress',
  'libraryGlobalEnabled',
  'libraryScope',
  'libraryScopeOnboardingVersion',
  'theme',
  'shareAppThemeAcrossVaults',
  'uiLanguage',
  'promptLanguage',
  'interfaceScale',
  'accessibleFont',
  'highContrast',
  'reduceMotion',
  'readingFocusMode',
  // Toolkit pins are a user preference, not vault content. Their position stays
  // in each vault's sidebarOrder, but the chosen shortcuts follow vault switches.
  'toolkitPinnedPages',
  'announcementsEnabled',
  'betaUpdates',
  'favorites',
  'imageFavorites',
  'mascotEnabled',
  'mascotScale',
  'mascotAlwaysOnTop',
  'mascotVaultCostumes',
  'mascotStyle',
  'mascotStyleChosen',
  'mascotOrbColorMode',
  'mascotOrbColor',
  'aiConcurrencyMode',
  'aiConcurrencyVersion',
  'concurrency',
  'basicsTutorialVersion',
  'firstVaultVersion',
  'tutorialVideosWatched',
  'recoverySetupVersion',
  'backupVaultIds',
  'backupIncludePreferences',
  'backupIncludeHistories',
  'backupIncludeGeneratedMedia',
  'backupIncludeApiKeys',
  'autoBackupEnabled',
  'autoBackupFolder',
  'autoBackupIntervalHours',
  'autoBackupDays',
  'autoBackupHour',
  'autoBackupMinute',
  'lastAutoBackupAt',
  'lastAutoBackupStatus',
  'backupCleanupEnabled',
  'backupRetentionValue',
  'backupRetentionUnit',
  'lastBackupCleanupAt',
  'lastBackupCleanupStatus',
  // Nodus Browser. These live here rather than per vault because the browser
  // is one browser: a site you allowed the camera for, or signed into, must not
  // change identity when you switch vault. It also means the feature needs no
  // schema migration, and rides the existing backup of app-prefs.json.
  'browserSitePermissions',
  'browserDownloadFolder',
  'browserHomeMode',
  'browserHomeUrl',
  'browserNewTabMode',
  'browserSearchEngine',
  'browserSearchTemplate',
  'browserHistoryRetention',
  'browserClearHistoryOnClose',
  // The processing log is one global file (a corpus run crosses vaults and the Library), so
  // its retention, its hard entry cap and the language its lines are rendered in cannot live
  // per vault — switching vault must not hide half the failures.
  'pipelineLogRetention',
  'pipelineLogMaxEntries',
  'pipelineLogLanguage',
] as const;
export type GlobalPrefKey = (typeof GLOBAL_PREF_KEYS)[number];

/** Keys that are profile-wide only while the user shares one palette across vaults. */
export const SHARED_APPEARANCE_KEYS = ['appTheme', 'customThemes'] as const;
export type SharedAppearanceKey = (typeof SHARED_APPEARANCE_KEYS)[number];

export const SHARED_MODEL_KEYS = [
  'codexReasoningEfforts',
  // The Research composer's memory of the level it last used per model. A level belongs
  // to the model, not to the vault that happened to be open when it was picked.
  'researchEffortByModel',
  // Whether Research Chat may search the web is the user's choice, not the vault's.
  'researchWebSearch',
  'localProviders',
  // The user's own OpenAI-compatible endpoint. App-level like the local base URLs:
  // one gateway serves every vault, and re-typing the URL per vault is nobody's idea
  // of a preference.
  'customProvider',
  'providerFreeTier',
  'extractionModel',
  'visionModel',
  'synthesisModel',
  'summaryModel',
  'fusionModel',
  'nodiModel',
  'transcriptionModel',
  'sttProvider',
  'sttTransformersModel',
  'sttWhisperCppModel',
  'sttWhisperCppExecutable',
  'imageProvider',
  'imageModel',
  'imageQuality',
  'imageStyle',
  'audioProvider',
  'audioVoice',
  'audioSpeed',
] as const;
export type SharedModelKey = (typeof SHARED_MODEL_KEYS)[number];

export type SharedPrefKey = GlobalPrefKey | SharedModelKey | SharedAppearanceKey;
export const ALL_SHARED_KEYS: readonly SharedPrefKey[] = [...GLOBAL_PREF_KEYS, ...SHARED_MODEL_KEYS];

/**
 * Whether one palette serves every vault.
 *
 * Read straight from the file because callers ask before the settings merge has run.
 * Anything that is not exactly `true` means per-vault, which is both the default and
 * the safe reading of a hand-edited or half-written file.
 */
export function sharesAppThemeAcrossVaults(prefs: Record<string, unknown> = readGlobalPrefsRaw()): boolean {
  return prefs.shareAppThemeAcrossVaults === true;
}

/**
 * The keys stored in the profile file instead of a vault's own settings blob.
 *
 * The appearance keys join this list only while the palette is shared. Listing them
 * here rather than in GLOBAL_PREF_KEYS is what lets the scope change at runtime
 * without a schema migration: the same settings key simply resolves to a different
 * store depending on the current policy.
 */
export function sharedKeysFor(sharedAppearance: boolean): readonly SharedPrefKey[] {
  return sharedAppearance ? [...GLOBAL_PREF_KEYS, ...SHARED_APPEARANCE_KEYS] : GLOBAL_PREF_KEYS;
}

/**
 * Whether a key's storage follows the palette scope rather than being always global.
 *
 * The palette keys are the one family written to both stores while shared, so callers
 * that decide where a value lands ask this instead of comparing against the list.
 */
export function isSharedAppearanceKey(key: SharedPrefKey): key is SharedAppearanceKey {
  return (SHARED_APPEARANCE_KEYS as readonly string[]).includes(key);
}

export function globalPrefKeys(prefs: Record<string, unknown> = readGlobalPrefsRaw()): readonly SharedPrefKey[] {
  return sharedKeysFor(sharesAppThemeAcrossVaults(prefs));
}

function prefsFile(): string {
  return path.join(app.getPath('userData'), 'app-prefs.json');
}

export function readGlobalPrefsRaw(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readGlobalPrefs(): Partial<Pick<AppSettings, SharedPrefKey>> {
  return readGlobalPrefsRaw() as Partial<Pick<AppSettings, SharedPrefKey>>;
}

export function writeGlobalPrefsRaw(patch: Record<string, unknown>): void {
  const next = { ...readGlobalPrefsRaw(), ...patch };
  const target = prefsFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
  fs.renameSync(temporary, target);
}

export function writeGlobalPrefs(patch: Partial<Pick<AppSettings, SharedPrefKey>>): void {
  writeGlobalPrefsRaw(patch as Record<string, unknown>);
}

/** Split a settings patch into its global (shared) and per-vault parts. Language/theme
 *  keys move out of the per-vault blob entirely; the shared model keys are mirrored to
 *  the global store but kept in `local` too, so each vault retains a per-vault fallback.
 *
 *  `sharedAppearance` is passed in rather than re-read when the caller already knows
 *  the outcome of the patch being applied — flipping the switch and setting a palette
 *  in the same patch must route by the NEW scope, not the stored one. */
export function splitGlobalPatch(
  patch: Partial<AppSettings>,
  sharedAppearance: boolean = sharesAppThemeAcrossVaults(),
): {
  global: Partial<Pick<AppSettings, SharedPrefKey>>;
  local: Partial<AppSettings>;
} {
  const global: Partial<Pick<AppSettings, SharedPrefKey>> = {};
  const local: Partial<AppSettings> = { ...patch };
  const globalKeys = sharedKeysFor(sharedAppearance);
  for (const key of globalKeys) {
    if (key in patch) {
      (global as Record<string, unknown>)[key] = patch[key];
      // The palette is mirrored, never moved: while the palette is shared each vault
      // still records the value it was last showing, so switching back to per-vault
      // restores that vault's own palette instead of dropping it to the default.
      if (isSharedAppearanceKey(key)) continue;
      delete (local as Record<string, unknown>)[key];
    }
  }
  for (const key of SHARED_MODEL_KEYS) {
    if (key in patch) {
      (global as Record<string, unknown>)[key] = patch[key];
    }
  }
  return { global, local };
}
