import { materializeTrustedPluginSkills } from '../capabilities/skillLibrary';
import { BrowserWindow } from 'electron';
import { validateSettingsSubmission, validateSettingsState } from '../../packages/capability-api/src/settings';
import { validateViewDocument } from '../../packages/capability-api/src/views';
import { capabilityRegistry, onCapabilityRegistryChanged, rebuildCapabilityRegistry, type CapabilityProvider } from '../capabilities/registry';
import { contractFences } from '../../packages/capability-api/src/chat';
import { approvePendingPluginV2, discardPendingPluginV2, listInstalledPluginsV2, pendingPluginPermissions, removePluginV2, resolveTrustedCapability, rollbackPluginV2 } from '../capabilities/pluginStoreV2';
import { acquireCapabilityWorker, stopPluginWorkers } from '../capabilities/workerHost';
import { createCapabilityHostServices } from '../capabilities/hostServices';
import { writeCapabilitySecret } from '../capabilities/hostServices';
import { createCapabilityAdapters } from '../capabilities/runner';
import { artifactSidecar, readCapabilityArtifact } from '../capabilities/artifactStore';
import { fetchCapabilityCatalog, installCatalogPlugin, readCachedCatalog } from '../capabilities/marketplaceV2';
import { legacyResultRequest } from '../capabilities/legacyResults';
import { fetchCapabilityTile } from '../capabilities/tileProxy';
import { checkForCapabilityUpdates, setCapabilityAutoUpdate } from '../capabilities/updates';
import { migrationSettled, readMigrationJournal } from '../capabilities/migration';
import { capabilityMigrationRunning, migrateCapabilitiesForThisProfile, runPluginDataMigrations } from '../capabilities/migrationRunner';
import { pinCapabilitiesForTurn } from '../capabilities/registry';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { getSettings } from '../db/settingsRepo';
import type { IpcContext } from './context';

/** One generic surface for every capability, whatever discipline it happens to serve.
 *
 *  There is no chemistry channel and no genomics channel: the renderer asks the registry
 *  what exists, asks a capability for its own settings schema, and renders whatever
 *  declarative view comes back. Adding a discipline adds no IPC. */

function providerOrThrow(capabilityId: string): CapabilityProvider {
  const provider = capabilityRegistry().providers.get(capabilityId);
  if (!provider || provider.source !== 'plugin') throw new Error('That capability is not provided by an installed package.');
  return provider;
}

/** A worker outside a chat turn: settings, health and rendering a stored result. There is
 *  no conversation to charge, so the model and attachment lanes are simply absent. */
function detachedWorker(capabilityId: string) {
  const provider = providerOrThrow(capabilityId);
  const runtime = resolveTrustedCapability(capabilityId, pinCapabilitiesForTurn().pins.get(capabilityId));
  if (!runtime) throw new Error('That capability is not installed.');
  const services = createCapabilityHostServices(createCapabilityAdapters({
    locale: 'en', pins: pinCapabilitiesForTurn(),
    runCoreStages: async answer => answer,
  }));
  return { provider, runtime, handle: acquireCapabilityWorker(runtime, { services }) };
}

export function registerCapabilitiesIpc(context: IpcContext): void {
  const { h } = context;

  onCapabilityRegistryChanged(snapshot => {
    const payload = {
      revision: snapshot.revision,
      providers: [...snapshot.providers.values()].map(summarize),
      problems: snapshot.problems,
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('capabilities:registryChanged', payload);
    }
  });

  h('capabilities:list', async () => {
    const snapshot = capabilityRegistry();
    return {
      revision: snapshot.revision,
      providers: [...snapshot.providers.values()].map(summarize),
      problems: snapshot.problems,
      plugins: installedPluginsWithPendingPermissions(),
      catalog: readCachedCatalog(),
    };
  });

  h('capabilities:health', async (_event, capabilityId: string) => {
    const { runtime, handle } = detachedWorker(capabilityId);
    return handle.call('health', {
      nodusVersion: process.env.npm_package_version ?? '',
      locale: 'en', platform: process.platform, arch: process.arch,
      dataVersion: listInstalledPluginsV2().find(state => state.id === runtime.plugin.id)?.dataVersion ?? 0,
    }, { timeoutMs: 30_000 });
  });

  h('capabilities:getSettings', async (_event, capabilityId: string) => {
    const { provider, handle } = detachedWorker(capabilityId);
    if (!provider.hasSettings) throw new Error('That capability has no settings.');
    const manifest = settingsManifest(capabilityId);
    return { manifest, state: validateSettingsState(await handle.call('getSettings', {}, { timeoutMs: 30_000 }), manifest) };
  });

  h('capabilities:applySettings', async (_event, capabilityId: string, submission: unknown) => {
    const { provider, runtime, handle } = detachedWorker(capabilityId);
    if (!provider.hasSettings) throw new Error('That capability has no settings.');
    const manifest = settingsManifest(capabilityId);
    const validated = validateSettingsSubmission(submission, manifest);

    // A secret never reaches the worker. It goes to the encrypted store here, and the
    // worker is told only that the field was submitted.
    const forWorker: Record<string, string | boolean> = {};
    for (const [id, value] of Object.entries(validated.fields)) {
      const field = manifest.fields.find(candidate => candidate.id === id);
      if (field?.kind === 'secret') {
        writeCapabilitySecret(runtime.plugin.id, runtime.manifest.id, id, typeof value === 'string' ? value : null);
        continue;
      }
      forWorker[id] = value;
    }
    return validateSettingsState(await handle.call('applySettings', { fields: forWorker }, { timeoutMs: 60_000 }), manifest);
  });

  h('capabilities:runAction', async (_event, capabilityId: string, actionId: string) => {
    const { provider, handle } = detachedWorker(capabilityId);
    const manifest = settingsManifest(capabilityId);
    if (!provider.hasSettings || !manifest.actions.some(action => action.id === actionId)) throw new Error('That capability has no such action.');
    // An action may install a runtime, so it gets the long end of the tool window.
    return validateSettingsState(await handle.call('runAction', { actionId }, { timeoutMs: 300_000 }), manifest);
  });

  h('artifacts:render', async (_event, source: string, locale = 'en') => {
    const sidecar = artifactSidecar(source);
    if (!sidecar) return { available: false as const, reason: 'missing' as const };
    const provider = capabilityRegistry().providers.get(sidecar.capabilityId);
    // A result whose package is gone still shows what it was and who made it, with a way
    // to get the provider back, instead of disappearing from the conversation.
    if (!provider || provider.source !== 'plugin') {
      return { available: false as const, reason: 'no-provider' as const, sidecar };
    }
    const envelope = readCapabilityArtifact(source);
    if (!envelope) return { available: false as const, reason: 'unreadable' as const, sidecar };
    const { handle } = detachedWorker(sidecar.capabilityId);
    const view = await handle.call('renderArtifact', {
      artifactType: envelope.artifactType, artifactVersion: envelope.artifactVersion,
      data: envelope.data, locale,
    }, { timeoutMs: 60_000 });
    return { available: true as const, sidecar, view: validateViewDocument(view) };
  });

  /** One historical block, rendered by whichever package now owns that fence.
   *
   *  An answer the user already received keeps being an answer: the reply is not rewritten
   *  and the old file beside it is not converted, they are simply read and handed to the
   *  package that understands them. With nothing installed the renderer is told so, and
   *  shows what the block was with a way to get the provider back — never a placeholder
   *  that pretends the result is still being produced. */
  h('capabilities:renderLegacyResult', async (_event, fence: string, payload: string, locale = 'en') => {
    const request = legacyResultRequest(fence, payload);
    if (!request) return { available: false as const, reason: 'no-provider' as const };
    const { handle } = detachedWorker(request.provider.id);
    const view = await handle.call('renderLegacyResult', {
      fence: request.fence,
      artifactType: request.artifactType,
      artifactVersion: request.artifactVersion,
      payload: request.payload,
      ...(request.asset !== undefined ? { asset: request.asset } : {}),
      locale,
    }, { timeoutMs: 60_000 });
    return {
      available: true as const,
      capabilityId: request.provider.id,
      pluginId: request.provider.plugin?.id,
      view: validateViewDocument(view),
    };
  });

  /** What the migration is doing, in terms the interface can show without interpreting a
   *  journal. A package is only `complete` once it is installed, migrated and registered:
   *  anything short of that is still in progress or still retryable. */
  /** One tile of a IIIF image, fetched by the host.
   *
   *  The renderer gets bytes and never a URL it could load itself, so a tiled image
   *  cannot become a way for a page to reach an origin on its own. */
  h('capabilities:tile', async (_event, capabilityId: string, service: string, tilePath: string) => {
    const tile = await fetchCapabilityTile({ capabilityId: String(capabilityId), service: String(service), path: String(tilePath) });
    return { bytes: tile.bytes, mimeType: tile.mimeType };
  });

  h('capabilities:migrationStatus', async () => {
    const journal = readMigrationJournal();
    const registry = capabilityRegistry();
    const registered = new Set([...registry.providers.values()].flatMap(provider => provider.plugin ? [provider.plugin.id] : []));
    return {
      running: capabilityMigrationRunning(),
      settled: migrationSettled(),
      journal,
      entries: (journal?.entries ?? []).map(entry => {
        const state = listInstalledPluginsV2().find(candidate => candidate.id === entry.pluginId);
        return {
          pluginId: entry.pluginId,
          phase: entry.phase,
          reason: entry.reason,
          attempts: entry.attempts,
          updatedAt: entry.updatedAt,
          // The journal stores the failure in the language it was thrown in, which is the
          // source language, because it outlives the setting it was recorded under. It is
          // translated on the way out instead — `localizeIpcPayload` only walks `message`
          // and `error`, and this one is called `failure`.
          ...(entry.failure ? { failure: localizeRuntimeError(entry.failure, getSettings().uiLanguage) } : {}),
          installed: Boolean(state?.active),
          dataVersion: state?.dataVersion ?? 0,
          registered: registered.has(entry.pluginId),
        };
      }),
      problems: registry.problems,
    };
  });

  h('capabilities:retryMigration', async () => {
    const outcome = await migrateCapabilitiesForThisProfile();
    rebuildCapabilityRegistry();
    broadcastMigrationChanged();
    return outcome;
  });

  h('capabilities:refreshCatalog', async (_event, sourceUrl: string) => fetchCapabilityCatalog(sourceUrl));

  /** Checks the catalog and applies what may be applied without asking. An update that
   *  wants more than the installed version was allowed is staged, not installed. */
  h('capabilities:checkUpdates', async (_event, pluginId?: string) => {
    const results = await checkForCapabilityUpdates(pluginId ? { only: pluginId } : {});
    broadcastMigrationChanged();
    return results;
  });

  h('capabilities:setAutoUpdate', async (_event, pluginId: string, autoUpdate: boolean) => setCapabilityAutoUpdate(pluginId, autoUpdate));

  h('capabilities:installPlugin', async (_event, pluginId: string, approvePermissions = false) => {
    const outcome = await installCatalogPlugin(pluginId, { approvePermissions });
    // A freshly installed package climbs its own ladder before it is announced. Without
    // this, a package that declares migrations would sit unregistered until the next
    // launch, and the first thing a user did with it would run against version 0 data.
    if (outcome.activated) await activateAfterMigration(pluginId);
    // A package that stopped at its permissions carries them back with it, so the interface
    // can ask in the same gesture instead of sending the user looking for where to approve.
    return {
      state: listInstalledPluginsV2().find(state => state.id === pluginId) ?? outcome.state,
      activated: outcome.activated,
      pendingPermissions: pendingPluginPermissions(pluginId),
    };
  });

  h('capabilities:approvePlugin', async (_event, pluginId: string) => {
    const state = approvePendingPluginV2(pluginId);
    await stopPluginWorkers(pluginId);
    rebuildCapabilityRegistry();
    await activateAfterMigration(pluginId);
    return listInstalledPluginsV2().find(candidate => candidate.id === pluginId) ?? state;
  });

  /** The other half of asking: a refusal has to be able to undo the staging the question
   *  needed, or declining would cost the user a package stuck half-installed. */
  h('capabilities:discardPendingPlugin', async (_event, pluginId: string) => {
    await stopPluginWorkers(pluginId);
    discardPendingPluginV2(pluginId);
    rebuildCapabilityRegistry();
    broadcastMigrationChanged();
    return installedPluginsWithPendingPermissions();
  });

  h('capabilities:rollbackPlugin', async (_event, pluginId: string) => {
    const state = rollbackPluginV2(pluginId);
    await stopPluginWorkers(pluginId);
    rebuildCapabilityRegistry();
    materializeTrustedPluginSkills(pluginId);
    broadcastMigrationChanged();
    return state;
  });

  /** Runs a newly active version's migrations, then rebuilds. A failure here leaves the
   *  package installed and unannounced with something to retry, which is the same state a
   *  failed profile migration leaves, and never takes the rest of the application with it. */
  async function activateAfterMigration(pluginId: string): Promise<void> {
    try { await runPluginDataMigrations(pluginId); }
    catch (error) { console.warn(`[capabilities] ${pluginId} could not finish its data migration:`, error); }
    rebuildCapabilityRegistry();
    materializeTrustedPluginSkills(pluginId);
    broadcastMigrationChanged();
  }

  h('capabilities:removePlugin', async (_event, pluginId: string, purgeData = false) => {
    await stopPluginWorkers(pluginId);
    removePluginV2(pluginId, { purgeData });
    rebuildCapabilityRegistry();
    return listInstalledPluginsV2();
  });
}

/** The installed packages, each carrying what a version waiting on approval is asking for.
 *  Read here rather than left to the renderer, so the question the user answers is always
 *  the one the store would actually apply. */
function installedPluginsWithPendingPermissions() {
  return listInstalledPluginsV2().map(state => ({ ...state, pendingPermissions: pendingPluginPermissions(state.id) }));
}

/** Tells every window that the migration moved, so a panel showing it does not have to
 *  poll to find out. */
function broadcastMigrationChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('capabilities:migrationChanged');
      win.webContents.send('chatSkills:changed');
    }
  }
}

function summarize(provider: CapabilityProvider) {
  return {
    id: provider.id, version: provider.version, description: provider.description,
    source: provider.source, plugin: provider.plugin,
    tools: provider.tools.map(tool => ({ id: tool.id, description: tool.description, metered: tool.metered })),
    artifacts: provider.artifacts,
    chat: provider.chat ? {
      priority: provider.chat.priority,
      pendingLabel: provider.chat.pendingLabel,
      fences: contractFences(provider.chat),
      // Split out, because the two mean opposite things to a reader: a request fence is
      // something still being produced, a legacy fence is an answer that was produced long
      // ago and only needs rendering.
      legacyFences: provider.chat.legacyResults.map(entry => entry.fence),
    } : undefined,
    hasSettings: provider.hasSettings,
  };
}

function settingsManifest(capabilityId: string) {
  const runtime = resolveTrustedCapability(capabilityId, pinCapabilitiesForTurn().pins.get(capabilityId));
  if (!runtime?.manifest.settings) throw new Error('That capability has no settings.');
  return runtime.manifest.settings;
}
