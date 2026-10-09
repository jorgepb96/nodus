import { CORE_CAPABILITY_IDS } from '../../packages/capability-api/src/limits';
import { contractFences, type CapabilityChatContractV2 } from '../../packages/capability-api/src/chat';
import type { ArtifactTypeManifestV1 } from '../../packages/capability-api/src/artifacts';
import type { CapabilityManifestV2, CapabilityToolV2 } from '../../packages/capability-api/src/manifest';
import { listInstalledPluginsV2, readStagedPackage, type InstalledPluginStateV2 } from './pluginStoreV2';
import path from 'node:path';
import { app } from 'electron';
import { VISION_TOOLS } from '../../skill-capabilities/builtins/vision/contract';
import { MAP_TOOLS } from '../../skill-capabilities/builtins/maps/contract';

/** Who provides what, right now.
 *
 *  The core no longer knows that chemistry exists. It knows that something may provide
 *  `nodus:chemistry`, that exactly one thing may, and that whatever does declares its own
 *  fences, tools and artifact types. Installing or removing a package changes this table
 *  and nothing else. */

export interface CapabilityProvider {
  id: string;
  version: string;
  description: string;
  source: 'core' | 'plugin';
  plugin?: { id: string; version: string; digest: string };
  capabilityKey?: string;
  tools: CapabilityToolV2[];
  chat?: CapabilityChatContractV2;
  artifacts: ArtifactTypeManifestV1[];
  hasSettings: boolean;
}

export interface CapabilityRegistrySnapshot {
  /** Capability id → the one provider registered for it. */
  providers: ReadonlyMap<string, CapabilityProvider>;
  /** Fence tag → the provider that claimed it. Two providers may not share one. */
  fences: ReadonlyMap<string, { provider: CapabilityProvider; kind: 'request' | 'legacy' }>;
  /** Chat providers in the order the pipeline must run them. */
  chatOrder: readonly CapabilityProvider[];
  /** Why a package that is installed did not end up registered. */
  problems: ReadonlyArray<{ pluginId: string; detail: string }>;
  revision: number;
}

const CORE_PROVIDERS: CapabilityProvider[] = [
  { id: 'nodus:vision', version: '1.0.0', description: 'Bounded visual relevance review with the selected model.', source: 'core', tools: VISION_TOOLS, artifacts: [], hasSettings: false },
  { id: 'nodus:maps', version: '1.0.0', description: 'Deterministic SVG cartography with approved source retrieval and provenance.', source: 'core', tools: MAP_TOOLS, artifacts: [], hasSettings: false },
  { id: 'nodus:svg', version: '1.0.0', description: 'Sanitized SVG rendering and quality review.', source: 'core', tools: [], artifacts: [], hasSettings: false },
  { id: 'nodus:image', version: '1.0.0', description: 'Image generation using the configured provider.', source: 'core', tools: [], artifacts: [], hasSettings: false },
  { id: 'nodus:3d', version: '1.0.0', description: 'Validation, storage and interactive viewing of glTF and GLB models.', source: 'core', tools: [], artifacts: [], hasSettings: false },
];

let snapshot: CapabilityRegistrySnapshot = emptySnapshot();
const listeners = new Set<(next: CapabilityRegistrySnapshot) => void>();

function emptySnapshot(): CapabilityRegistrySnapshot {
  const providers = new Map(CORE_PROVIDERS.map(provider => [provider.id, provider]));
  return { providers, fences: new Map(), chatOrder: [], problems: [], revision: 0 };
}

export function capabilityRegistry(): CapabilityRegistrySnapshot { return snapshot; }

export function onCapabilityRegistryChanged(listener: (next: CapabilityRegistrySnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function providerFor(state: InstalledPluginStateV2, manifest: CapabilityManifestV2): CapabilityProvider {
  return {
    id: manifest.provides,
    version: manifest.version,
    description: manifest.description,
    source: 'plugin',
    // The SLOT's label, which is what identifies the installation: this is the turn pin
    // (pinCapabilitiesForTurn below), and resolveTrustedCapability both matches it against
    // state.active and builds `<version>-<digest>` from it. It must stay the slot label even
    // when the slot holds newer content. The CONTENT's version is `version` above, and that is
    // what an artifact is stamped with — see persistArtifact in runner.ts.
    plugin: { id: state.id, version: state.active!.version, digest: state.active!.digest },
    capabilityKey: manifest.id,
    tools: manifest.tools,
    ...(manifest.chat ? { chat: manifest.chat } : {}),
    artifacts: manifest.artifacts,
    hasSettings: Boolean(manifest.settings),
  };
}

/** Rebuilds the table from what is installed. Core first, so no package can take a core
 *  capability by registering before it; then plugins, in a stable order. A package that
 *  collides with something already registered is refused as a whole: a half-registered
 *  plugin would be harder to reason about than one that is simply not there. */
export function rebuildCapabilityRegistry(): CapabilityRegistrySnapshot {
  const providers = new Map<string, CapabilityProvider>(CORE_PROVIDERS.map(provider => [provider.id, provider]));
  const fences = new Map<string, { provider: CapabilityProvider; kind: 'request' | 'legacy' }>();
  const priorities = new Map<number, string>();
  const problems: Array<{ pluginId: string; detail: string }> = [];

  for (const state of [...listInstalledPluginsV2()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!state.active || state.status === 'failed' || state.status === 'pending-migration') {
      if (state.active) problems.push({ pluginId: state.id, detail: `The plugin is ${state.status}.` });
      continue;
    }
    let candidates: CapabilityProvider[];
    try {
      const staged = readStagedPackage(
        path.join(app.getPath('userData'), 'plugins', 'installed', state.id, 'versions', `${state.active.version}-${state.active.digest}`),
        state.active.digest, state.active.target,
      );
      // Installed is not the same as usable. A package whose data has not finished
      // climbing its own migration ladder is not announced at all: a capability that is
      // offered while its state is half-moved is a capability that will be used on data
      // it cannot read. It appears the moment the migration finishes and the table is
      // rebuilt — which is the only race that matters here, and it is settled in this
      // direction on purpose.
      if (state.dataVersion < staged.manifest.migrations.length) {
        problems.push({ pluginId: state.id, detail: `Waiting for its data migration (${state.dataVersion} of ${staged.manifest.migrations.length}).` });
        continue;
      }
      candidates = staged.capabilities.map(entry => providerFor(state, entry.manifest));
    } catch (error) {
      problems.push({ pluginId: state.id, detail: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const conflict = candidates.flatMap(provider => {
      if (providers.has(provider.id)) return [`${provider.id} is already provided by ${providers.get(provider.id)!.plugin?.id ?? 'the core'}.`];
      const duplicate = contractFences(provider.chat ?? { priority: 0, requestProtocols: [], legacyResults: [], hooks: {}, pendingLabel: { en: '' } })
        .find(fence => fences.has(fence));
      if (duplicate) return [`the ${duplicate} protocol is already claimed by ${fences.get(duplicate)!.provider.plugin?.id}.`];
      if (provider.chat && priorities.has(provider.chat.priority)) return [`chat priority ${provider.chat.priority} is already taken by ${priorities.get(provider.chat.priority)}.`];
      return [];
    })[0];
    if (conflict) { problems.push({ pluginId: state.id, detail: `Not registered because ${conflict}` }); continue; }

    for (const provider of candidates) {
      providers.set(provider.id, provider);
      if (!provider.chat) continue;
      priorities.set(provider.chat.priority, state.id);
      for (const protocol of provider.chat.requestProtocols) fences.set(protocol.fence, { provider, kind: 'request' });
      for (const legacy of provider.chat.legacyResults) fences.set(legacy.fence, { provider, kind: 'legacy' });
    }
  }

  const chatOrder = [...providers.values()].filter(provider => provider.chat).sort((a, b) => a.chat!.priority - b.chat!.priority);
  snapshot = { providers, fences, chatOrder, problems, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener(snapshot);
  return snapshot;
}

/** A capability id resolves only while something provides it. Normalizing a short name
 *  is not the same as resolving it: `chemistry` still reads as `nodus:chemistry` when no
 *  plugin is installed, and still does not work. */
export const capabilityIsAvailable = (id: string): boolean => snapshot.providers.has(id);

export const capabilityProvider = (id: string): CapabilityProvider | undefined => snapshot.providers.get(id);

/** Taken once per turn. Every call in that turn uses the same digests, so a package that
 *  updates while a reply is being produced cannot change what that reply is running. */
export interface TurnPins { revision: number; pins: ReadonlyMap<string, { version: string; digest: string }> }

export function pinCapabilitiesForTurn(): TurnPins {
  const pins = new Map<string, { version: string; digest: string }>();
  for (const [id, provider] of snapshot.providers) {
    if (provider.plugin) pins.set(id, { version: provider.plugin.version, digest: provider.plugin.digest });
  }
  return { revision: snapshot.revision, pins };
}

export const CORE_CAPABILITY_ID_LIST = CORE_CAPABILITY_IDS;
