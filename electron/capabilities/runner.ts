import type { VisionSession } from './vision/service';
import path from 'node:path';
import fs from 'node:fs';
import type { ModelRef } from '@shared/types';
import { serializeChatVisualPart } from '@shared/chatSkills';
import { documentedContextWindow } from '@shared/providerContextWindows';
import { completeText } from '../ai/aiClient';
import { storeCapabilityFile } from '../chatAssets';
import { validateViewDocument, type ViewDocumentV1 } from '../../packages/capability-api/src/views';
import type { WorkerArtifactV1 } from '../../packages/capability-api/src/artifacts';
import type { ChatAstNode } from '../../packages/capability-api/src/chat';
import type { ChatModelBudgetV1 } from '../../packages/capability-api/src/worker';
import { acquireCapabilityWorker, leaseCapabilityScope, type TrustedWorkerRuntime } from './workerHost';
import { createCapabilityHostServices, type CapabilityServiceAdapters } from './hostServices';
import { resolveTrustedCapability } from './pluginStoreV2';
import { serializeArtifactReference, storeCapabilityArtifact } from './artifactStore';
import { inspectCapabilitySvg, refineCapabilitySvg, validateCapabilitySvg } from './svgServices';
import { ensurePythonRuntime, runInPythonRuntime, validateRuntimeLock } from './pythonRuntime';
import { runCapabilitySubworker } from './subworkerPool';
import type { CapabilityProvider } from './registry';
import type { TurnPins } from './registry';
import type { TrustedCapabilityRunner } from './chatPipeline';

/** Assembles the pieces for one turn: the pinned package, its worker, the host services
 *  it is allowed to reach, and where its results are stored. */

/** The host's estimate of characters per token, passed to capabilities so that every consumer
 *  sizes its limits with ONE ratio instead of inventing its own. Same figure the research lane
 *  uses. An estimate, and documented as one. */
const CAPABILITY_CHARS_PER_TOKEN = 3.2;

/** What this turn's model can hold, for a capability to size its own limits against.
 *
 *  A model with no documented window yields an absent window rather than a guessed one, because
 *  a capability's own floor is a better answer than a number nobody verified — and `null` here
 *  must never be read as "unlimited". */
function chatModelBudget(model: ModelRef | null | undefined): ChatModelBudgetV1 | undefined {
  if (!model?.provider || !model.model) return undefined;
  const window = documentedContextWindow(model.provider, model.model);
  return window == null ? undefined : { contextWindowTokens: window, charsPerToken: CAPABILITY_CHARS_PER_TOKEN };
}

export interface TrustedTurnContext {
  vision?: VisionSession;
  renderStoredArtifacts?: boolean;
  owner?: string;
  question?: string;
  locale: string;
  model?: ModelRef | null;
  pins: TurnPins;
  /** Runners naming the same scope share their capability workers (see `leaseCapabilityScope`):
   *  one answer's phases, and the correction rounds after it, then reuse one process with its
   *  module caches instead of starting a cold one per phase. Absent, the runner's workers are
   *  its own and stop when it is disposed. */
  scope?: string;
  signal?: AbortSignal;
  beforeInvoke?: () => void;
  beforePaidCall?: () => void;
  beforeRepair?: () => void;
  runCoreStages: (answer: string, options: { suppressSvgRefinement: boolean }) => Promise<string>;
}

function runtimeFor(provider: CapabilityProvider, pins: TurnPins): TrustedWorkerRuntime {
  const pin = pins.pins.get(provider.id);
  const runtime = resolveTrustedCapability(provider.id, pin);
  if (!runtime) throw new Error(`${provider.id} is no longer installed.`);
  return runtime;
}

/** Downloads one pinned artifact through the capability's own declared permission, so a
 *  runtime install cannot reach anywhere the package did not ask for. */
function lockDownloader(runtime: TrustedWorkerRuntime, services: ReturnType<typeof createCapabilityHostServices>, signal: AbortSignal) {
  return async (url: string): Promise<Buffer> => {
    const target = new URL(url);
    const endpoint = (runtime.permissions.network ?? []).find(candidate => new URL(candidate.origin).origin === target.origin);
    if (!endpoint) throw new Error(`The package did not declare permission to reach ${target.origin}.`);
    const response = await services({
      runtime, channel: 'network', method: 'fetch', signal,
      payload: { endpointId: endpoint.id, path: `${target.pathname}${target.search}`, method: 'GET' },
    }) as { status: number; body: Uint8Array };
    if (response.status !== 200) throw new Error(`${url} returned ${response.status}.`);
    return Buffer.from(response.body);
  };
}

export function createCapabilityAdapters(context: TrustedTurnContext): CapabilityServiceAdapters {
  let services: ReturnType<typeof createCapabilityHostServices> | null = null;
  const adapters: CapabilityServiceAdapters = {
    vision: context.vision,
    beforePaidCall: context.beforePaidCall,
    async model(runtime, request, signal) {
      return completeText({
        system: (request.system ?? 'You answer exactly what is asked, with no preamble.').slice(0, 20_000),
        user: request.prompt.slice(0, 200_000),
        maxTokens: Math.min(Math.max(request.maxTokens ?? 4_000, 256), 16_000),
        temperature: 0, reasoning: 'off', plainContext: true, signal, noRetry: Boolean(context.beforePaidCall),
      }, context.model);
    },
    svg: {
      validate: validateCapabilitySvg,
      inspect: inspectCapabilitySvg,
      refine: (request, signal) => { context.beforeRepair?.(); return refineCapabilitySvg(request, context.model, signal, Boolean(context.beforePaidCall)); },
    },
    python: {
      async ensureRuntime(runtime, runtimeId, signal) {
        const declared = runtime.permissions.runtimes?.find(entry => entry.id === runtimeId);
        if (!declared) return { ready: false, detail: 'That runtime is not declared by the package.' };
        // One lock per interpreter version the package supports, named for it. A package
        // that supports only one ships `lock.json` and gets it whatever the interpreter is.
        const locks = path.join(path.dirname(runtime.entryPath), 'runtimes', runtimeId);
        // A package whose archive is target-independent (`compatibility.targets: ["any"]`) still
        // needs platform-specific wheels, so it may ship its locks under a `<platform>-<arch>`
        // subdirectory. Prefer that, then fall back to the flat layout a per-target archive uses.
        const target = `${process.platform}-${process.arch}`;
        const selectLock = (pythonVersion: string) => {
          for (const file of [
            path.join(target, `lock-${pythonVersion}.json`),
            path.join(target, 'lock.json'),
            `lock-${pythonVersion}.json`,
            'lock.json',
          ]) {
            try { return validateRuntimeLock(JSON.parse(fs.readFileSync(path.join(locks, file), 'utf8'))); }
            catch { /* try the next */ }
          }
          return null;
        };
        return ensurePythonRuntime(runtime, runtimeId, {
          download: lockDownloader(runtime, services!, signal),
          minVersion: declared.minVersion, selectLock, signal,
        });
      },
      run: (runtime, request, signal) => runInPythonRuntime(runtime, request, signal),
    },
    // An auxiliary process from the package's own bundle, with its own deadline and a kill
    // the host controls. It talks to nothing: one input in, one value out.
    subworker: (runtime, request, signal) => runCapabilitySubworker(runtime, request, signal),
    async attachments(runtime, request) {
      if (!context.owner) throw new Error('Start a saved chat before creating capability attachments.');
      const source = storeCapabilityFile(context.owner, { bytes: request.bytes, mimeType: request.mimeType, name: request.name });
      return { attachmentId: source.slice(source.lastIndexOf('/') + 1), bytes: request.bytes.length };
    },
  };
  services = createCapabilityHostServices(adapters);
  return adapters;
}

export function createTrustedCapabilityRunner(context: TrustedTurnContext): TrustedCapabilityRunner {
  // Computed once per turn, not per call: the model does not change inside a turn.
  const budget = chatModelBudget(context.model);
  const { scopeKey, release } = leaseCapabilityScope(context.scope);
  const services = createCapabilityHostServices(createCapabilityAdapters(context));
  const workerFor = (provider: CapabilityProvider) => {
    const runtime = runtimeFor(provider, context.pins);
    return { runtime, handle: acquireCapabilityWorker(runtime, { services, scopeKey }) };
  };

  const renderView = ({ provider, view }: { provider: CapabilityProvider; view: ViewDocumentV1 }): string =>
    serializeChatVisualPart({
      kind: 'capability-view', complete: true,
      // The owner travels with the view so a download node can be resolved against the
      // conversation that owns the attachment, never against a path the view chose.
      content: JSON.stringify({ capabilityId: provider.id, plugin: provider.plugin, owner: context.owner, view: validateViewDocument(view) }),
    });

  return {
    dispose: release,
    async invoke({ provider, toolId, input, nodeId }) {
      const tool = provider.tools.find(candidate => candidate.id === toolId);
      if (!tool) throw new Error(`${provider.id} has no tool ${toolId}.`);
      const { handle } = workerFor(provider);
      context.beforeInvoke?.();
      // A blown tool budget used to reach the author as "nodus:chemistry exceeded 180 seconds"
      // with nothing to say where the 180 went. Measured afterwards, the chemistry in that tool is
      // a third of a second: a cold WebAssembly load plus one parse of a 39-atom target. The time
      // goes on the model round-trips the tool makes — resolution, up to two repairs, then the
      // unverified fallback — so the budget is almost never spent on chemistry, and a timeout
      // without a timing line is undiagnosable. Logged on failure always, and on success only when
      // the call used more than half its budget, so an ordinary route stays quiet.
      // Restarted when the call is admitted: time queued behind the same tool is reported beside
      // the budget, not as part of it.
      let started = performance.now();
      let startedWall = Date.now();
      let queued = '';
      // Always, so a run's log carries the per-tool cost a later analysis can total. Suppressing
      // the quick successes left the dominant cost of a turn unmeasurable from its own log.
      const report = (outcome: string, detail = '') => {
        const spent = performance.now() - started;
        const wallSpent = Date.now() - startedWall;
        const drift = Math.abs(wallSpent - spent) > Math.max(250, spent * 0.1) ? ` · CLOCK STEPPED: wall says ${(wallSpent / 1000).toFixed(1)}s` : '';
        console.info(`${new Date().toISOString()} [capability] ${provider.id} ${toolId} ${outcome} in ${(spent / 1000).toFixed(1)}s of a ${(tool.timeoutMs / 1000).toFixed(0)}s budget${queued}${detail}${drift}`);
      };
      try {
        const result = await handle.call<Awaited<ReturnType<TrustedCapabilityRunner['invoke']>>>('invoke', {
          invocationId: `i${Math.random().toString(36).slice(2, 10)}`,
          toolId, input, locale: context.locale,
          chat: { question: context.question, nodeId, ...(budget ? { budget } : {}) },
        }, {
          timeoutMs: tool.timeoutMs, signal: context.signal, services,
          queue: { key: `invoke:${toolId}`, limit: tool.concurrency },
          onAdmitted: waited => {
            started = performance.now();
            startedWall = Date.now();
            if (waited >= 50) queued = ` · queued ${(waited / 1000).toFixed(1)}s`;
          },
        });
        report('ok');
        return result;
      } catch (error) {
        report(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
          error instanceof Error ? ` — ${error.message.replace(/\s+/g, ' ').slice(0, 200)}` : '');
        throw error;
      }
    },

    async hook({ provider, hook, nodes }: { provider: CapabilityProvider; hook: 'prepare' | 'finalize'; nodes: ChatAstNode[] }) {
      const { handle } = workerFor(provider);
      return handle.call(hook === 'prepare' ? 'prepareChat' : 'finalizeChat',
        { nodes, ...(hook === 'prepare' ? { question: context.question, ...(budget ? { budget } : {}) } : {}), locale: context.locale },
        { timeoutMs: 60_000, signal: context.signal, services });
    },

    async persistArtifact({ provider, artifact }: { provider: CapabilityProvider; artifact: WorkerArtifactV1 }) {
      if (!context.owner) throw new Error('Start a saved chat before a capability can store a result.');
      const declared = provider.artifacts.find(entry => entry.type === artifact.artifactType);
      if (!declared) throw new Error(`${provider.id} produced an undeclared artifact type.`);
      const reference = storeCapabilityArtifact(context.owner, artifact, {
        capabilityId: provider.id,
        // The CONTENT's version, not the slot's label. A sideload can replace what a slot
        // holds without renaming it, so the slot label can be older than the manifest inside
        // it — measured on one machine, a slot labelled 2.5.7 holding 2.5.23. The label is
        // still the right thing for RESOLVING the installation (provider.plugin, the turn pin),
        // but an artifact that names the wrong build makes an archive of runs useless as
        // evidence, and `provider.version` is the manifest's own version.
        plugin: provider.plugin
          ? { id: provider.plugin.id, version: provider.version, digest: provider.plugin.digest }
          : { id: 'core', version: '0.0.0', digest: '0'.repeat(64) },
        modelVisibility: declared.modelVisibility,
      });
      const pieces = [serializeArtifactReference(reference)];
      // A view that came with the artifact is rendered straight away, so the first paint
      // does not need a round trip back into the worker.
      if (artifact.view) {
        try { pieces.push(renderView({ provider, view: validateViewDocument(artifact.view) })); }
        catch { /* the stored artifact can still be rendered on demand */ }
      }
      else if (context.renderStoredArtifacts) {
        const { handle } = workerFor(provider);
        const view = await handle.call('renderArtifact', {
          artifactType: artifact.artifactType, artifactVersion: artifact.artifactVersion,
          data: artifact.data, locale: context.locale,
        }, { timeoutMs: 60_000, signal: context.signal, services });
        pieces.push(renderView({ provider, view: validateViewDocument(view) }));
      }
      return pieces.join('');
    },

    renderView,
    runCoreStages: context.runCoreStages,
  };
}
