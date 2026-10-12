import { materializeTrustedPluginSkills } from './skillLibrary';
import { compareSemver } from '../../packages/capability-api/src/json';
import { DEFAULT_SKILL_SOURCE } from '@shared/skillMarketplace';
import { fetchCapabilityCatalog, installCatalogEntry, readCachedCatalog, type CachedCatalog } from './marketplaceV2';
import { listInstalledPluginsV2, readPluginStateV2, writePluginAutoUpdate, type InstalledPluginStateV2 } from './pluginStoreV2';
import { rebuildCapabilityRegistry } from './registry';
import { runPluginDataMigrations } from './migrationRunner';
import { stopPluginWorkers } from './workerHost';

/** Keeping installed packages current, without ever deciding on the user's behalf.
 *
 *  An update is an install: the same signature check, the same digest pinning, the same
 *  refusal to go backwards or to accept a version number that has been republished over
 *  different bytes. Two things make it an update rather than a download. It only happens
 *  for a package whose `autoUpdate` the user left on, and it stops at the first sign that
 *  the new version wants more than the old one was allowed — a package that asks for more
 *  is staged and waits, because a permission the user approved once was approved for a
 *  particular set, not forever. */

export type CapabilityUpdateState = 'updated' | 'awaiting-approval' | 'incompatible' | 'current' | 'skipped' | 'failed';

export interface CapabilityUpdateResult {
  pluginId: string;
  state: CapabilityUpdateState;
  from?: string;
  to?: string;
  detail?: string;
}

export interface CapabilityUpdateOptions {
  /** Refresh the catalog first. Off for a check that must not touch the network. */
  refresh?: boolean;
  sourceUrl?: string;
  fetcher?: typeof fetch;
  /** Update this package even though its `autoUpdate` is off: the user asked for it. */
  only?: string;
}

/** True when the catalog offers something newer than what is installed. */
export function updateAvailable(state: InstalledPluginStateV2, catalog: CachedCatalog | null): string | null {
  const entry = catalog?.catalog.plugins.find(candidate => candidate.id === state.id);
  if (!entry || !state.active) return null;
  return compareSemver(entry.version, state.active.version) > 0 ? entry.version : null;
}

export async function checkForCapabilityUpdates(options: CapabilityUpdateOptions = {}): Promise<CapabilityUpdateResult[]> {
  const installed = listInstalledPluginsV2().filter(state => state.active && (!options.only || state.id === options.only));
  if (!installed.length) return [];

  let catalog: CachedCatalog | null = readCachedCatalog();
  if (options.refresh !== false) {
    try { catalog = await fetchCapabilityCatalog(options.sourceUrl ?? DEFAULT_SKILL_SOURCE, options.fetcher ?? fetch); }
    catch (error) {
      // An unreachable catalog is not a failed update. Nothing is installed, and what is
      // already installed keeps working.
      if (!catalog) return installed.map(state => ({ pluginId: state.id, state: 'failed' as const, detail: message(error) }));
    }
  }
  if (!catalog) return installed.map(state => ({ pluginId: state.id, state: 'skipped' as const, detail: 'No package catalog is available.' }));

  const results: CapabilityUpdateResult[] = [];
  for (const state of installed) {
    if (!options.only && !state.autoUpdate) {
      results.push({ pluginId: state.id, state: 'skipped', detail: 'Automatic updates are off for this package.' });
      continue;
    }
    // A package already waiting on the user is not asked again until they answer.
    if (state.pending) {
      results.push({ pluginId: state.id, state: state.pending.reason === 'permissions' ? 'awaiting-approval' : 'incompatible', to: state.pending.version });
      continue;
    }
    const entry = catalog.catalog.plugins.find(candidate => candidate.id === state.id);
    if (!entry) { results.push({ pluginId: state.id, state: 'skipped', detail: 'This package is no longer in the catalog.' }); continue; }
    const from = state.active!.version;
    if (compareSemver(entry.version, from) <= 0) { results.push({ pluginId: state.id, state: 'current', from }); continue; }

    try {
      // `approvePermissions` is deliberately absent: an update that expands what the
      // package may do is staged and waits for a person, never applied in the background.
      const outcome = await installCatalogEntry(entry, catalog, { fetcher: options.fetcher });
      if (!outcome.activated) {
        results.push({
          pluginId: state.id,
          state: outcome.state.pending?.reason === 'permissions' ? 'awaiting-approval' : 'incompatible',
          from, to: entry.version,
        });
        continue;
      }
      // The old process is running the old bytes; it goes before the new version is used.
      await stopPluginWorkers(state.id);
      await runPluginDataMigrations(state.id);
      materializeTrustedPluginSkills(state.id);
      results.push({ pluginId: state.id, state: 'updated', from, to: entry.version });
    } catch (error) {
      results.push({ pluginId: state.id, state: 'failed', from, to: entry.version, detail: message(error) });
    }
  }
  rebuildCapabilityRegistry();
  return results;
}

/** Turns automatic updates on or off for one package. */
export function setCapabilityAutoUpdate(pluginId: string, autoUpdate: boolean): InstalledPluginStateV2 {
  const state = writePluginAutoUpdate(pluginId, autoUpdate);
  return state;
}

export const capabilityUpdateSummary = (results: readonly CapabilityUpdateResult[]) => ({
  updated: results.filter(result => result.state === 'updated').map(result => result.pluginId),
  awaitingApproval: results.filter(result => result.state === 'awaiting-approval').map(result => result.pluginId),
  failed: results.filter(result => result.state === 'failed').map(result => result.pluginId),
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

export const installedStateFor = (pluginId: string) => readPluginStateV2(pluginId);
