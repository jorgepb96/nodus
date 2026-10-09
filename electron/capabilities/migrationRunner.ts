import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { safeStorage } from '../secrets/safeStorageGate';
import type { ChatSkill } from '@shared/chatSkills';
import { listChatSkills, profilePredatesSkillLibrary, replaceChatSkills } from '../chatSkills';
import { migrationBaseline } from './migrationBaselines';
import { listInstalledPluginsV2, readPluginStateV2 } from './pluginStoreV2';
import { runPluginDataMigrations as runPackageMigrations, settleInstalledPluginMigrations as settlePackages } from './dataMigrations';
import { createCapabilityAdapters } from './runner';
import { installCatalogPlugin } from './marketplaceV2';
import { runCapabilityMigration, pinnedPluginSkill, type MigrationOutcome } from './migration';

/** Binds the migration to the application: where the library lives, what 5.3.1 said, what
 *  each package now says, and which files the built-ins left behind for it to adopt. */

const profileFile = (...segments: string[]) => path.join(app.getPath('userData'), ...segments);

const readJson = (file: string): unknown => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
};

/** What each built-in left in the profile. The package decides what to do with it; the
 *  application only hands it over, and never reads a credential out of it itself. */
function legacyData(pluginId: string): unknown {
  if (pluginId === 'chemistry-studio') {
    const log = profileFile('chemistry-outcomes.jsonl');
    try {
      const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).slice(-500);
      return { chemistryOutcomes: lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) };
    } catch { return { chemistryOutcomes: [] }; }
  }
  if (pluginId === 'legalize') {
    const dir = profileFile('legalize-indexes');
    try {
      return {
        legalizeIndexes: fs.readdirSync(dir)
          .filter(name => name.endsWith('.json'))
          .map(name => ({ country: name.slice(0, -5), index: readJson(path.join(dir, name)) })),
      };
    } catch { return { legalizeIndexes: [] }; }
  }
  if (pluginId === 'alphagenome') {
    // The key is read here, decrypted once, and handed straight to the package's own
    // migration so it can re-encrypt it in the secret store. It is never written back to
    // disk in the clear, never logged and never put in the journal.
    try {
      const file = profileFile('genomics', 'credentials.bin');
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file)) return { genomics: null };
      const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as { apiKey?: string; terms?: string };
      // The accepted-terms string is handed over as it was recorded. Whether it still
      // counts as consent is the package's judgement, not the application's: only the
      // package knows which terms document its own version asks people to accept.
      return { genomics: { apiKey: stored.apiKey, termsVersion: stored.terms } };
    } catch { return { genomics: null }; }
  }
  return {};
}

/** The profile migration's own data step: the package's declared migrations, run with the
 *  adapters a capability has at runtime rather than a bare host. */
export async function runPluginDataMigrations(pluginId: string, legacy: unknown = {}): Promise<void> {
  const state = readPluginStateV2(pluginId);
  if (!state?.active) throw new Error(`${pluginId} is not active.`);
  const result = await runPackageMigrations(pluginId, legacy, createCapabilityAdapters({
    locale: 'en',
    pins: { revision: 0, pins: new Map() },
    runCoreStages: async answer => answer,
  }));
  if (result.notes) console.info(`[capabilities] ${pluginId}: ${result.notes}`);
}

/** The launch-time settle, with the adapters a capability has at runtime. */
export const settleInstalledPluginMigrations = (): Promise<string[]> => settlePackages(createCapabilityAdapters({
  locale: 'en',
  pins: { revision: 0, pins: new Map() },
  runCoreStages: async answer => answer,
}));

/** One migration at a time.
 *
 *  The run starts in the background at launch and the interface offers a retry, so two of
 *  them can be asked for at once. They would install the same package twice, race on the
 *  journal and disagree about what the library says, so the second caller joins the first
 *  instead of starting a second. */
let inFlight: Promise<MigrationOutcome> | null = null;

export const capabilityMigrationRunning = (): boolean => inFlight !== null;

export function migrateCapabilitiesForThisProfile(): Promise<MigrationOutcome> {
  if (inFlight) return inFlight;
  const run = runProfileMigration();
  inFlight = run;
  void run.catch(() => undefined).finally(() => { if (inFlight === run) inFlight = null; });
  return run;
}

function runProfileMigration(): Promise<MigrationOutcome> {
  return runCapabilityMigration({
    readSkills: () => listChatSkills(),
    writeSkills: (skills: ChatSkill[]) => { replaceChatSkills(skills); },
    baseline: migrationBaseline,
    packaged: pinnedPluginSkill,
    legacyData,
    migrateData: runPluginDataMigrations,
    preLibraryProfile: profilePredatesSkillLibrary(),
    installer: { online: pluginId => installCatalogPlugin(pluginId, { approvePermissions: true }) },
  });
}

export const migrationInstalledPlugins = () => listInstalledPluginsV2().map(state => state.id);
