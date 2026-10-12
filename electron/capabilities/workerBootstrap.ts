/** Generic entry point for every trusted capability worker.
 *
 *  One bootstrap for all packages: a plugin ships a module, not a process. The bootstrap
 *  owns the wire protocol, the host proxy and cancellation, so a plugin author writes a
 *  `CapabilityWorkerV2` and nothing else. Everything crossing the port is validated on
 *  both ends: a malformed frame must fail one call, never take the process down. */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { validateHostToWorker, type HostChannel, type WorkerToHostMessage } from '../../packages/capability-api/src/protocol';
import { TRUSTED_PROTOCOL } from '../../packages/capability-api/src/limits';
import type { CapabilityHostV2, CapabilityWorkerFactory, CapabilityWorkerV2, KeyValueStore, MigrationInputV1, MigrationResultV1, MigrationScriptV1 } from '../../packages/capability-api/src/worker';

interface InitMessage { type: 'init'; capabilityId: string; entryPath: string }

const port = process.parentPort;
if (!port) throw new Error('The capability bootstrap must run as a utility process.');

const post = (message: WorkerToHostMessage) => port.postMessage(message);

let nextCallId = 0;
const pendingHostCalls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; parent?: string }>();
/** The controller for work that belongs to no call (loading the module). A cancel without a call
 *  id cancels it and every call; the host kills the process if that is not enough within the
 *  grace period. */
let controller = new AbortController();
/** The host call each piece of work belongs to, followed through every await of the module's
 *  code, so `host.signal` is that call's and a cancel reaches that call alone. */
const currentCall = new AsyncLocalStorage<{ callId: string; controller: AbortController }>();
const callControllers = new Map<string, AbortController>();

function hostCall(channel: HostChannel, method: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = `h${nextCallId++}`;
    const parent = currentCall.getStore()?.callId;
    pendingHostCalls.set(callId, { resolve, reject, ...(parent ? { parent } : {}) });
    post({ type: 'host-call', callId, channel, method, payload, ...(parent ? { parentCallId: parent } : {}) });
  });
}

const store = (namespace: 'state' | 'cache'): KeyValueStore => ({
  get: key => hostCall('storage', `${namespace}.get`, { key }),
  set: (key, value) => hostCall('storage', `${namespace}.set`, { key, value }) as Promise<void>,
  delete: key => hostCall('storage', `${namespace}.delete`, { key }) as Promise<void>,
  keys: () => hostCall('storage', `${namespace}.keys`, {}) as Promise<string[]>,
});

const host: CapabilityHostV2 = {
  network: {
    fetch: (endpointId, request) => hostCall('network', 'fetch', { endpointId, ...request }) as ReturnType<CapabilityHostV2['network']['fetch']>,
    downloadToTemp: (endpointId, request) => hostCall('network', 'downloadToTemp', { endpointId, ...request }) as ReturnType<CapabilityHostV2['network']['downloadToTemp']>,
  },
  storage: {
    state: store('state'),
    cache: store('cache'),
    temp: { dir: () => hostCall('storage', 'temp.dir', {}) as Promise<string>, clear: () => hostCall('storage', 'temp.clear', {}) as Promise<void> },
  },
  secrets: {
    // `has` only: a worker learns whether a credential is configured, never its value.
    // The host injects the secret itself, into a header or a process's stdin.
    has: id => hostCall('secrets', 'has', { id }) as Promise<boolean>,
    store: (id, value) => hostCall('secrets', 'store', { id, value }) as Promise<void>,
    delete: id => hostCall('secrets', 'delete', { id }) as Promise<void>,
  },
  model: { complete: request => hostCall('model', 'complete', request) as Promise<string> },
  vision: {
    prepareImages: candidates => hostCall('vision', 'prepareImages', candidates) as ReturnType<CapabilityHostV2['vision']['prepareImages']>,
    reviewImages: request => hostCall('vision', 'reviewImages', request) as ReturnType<CapabilityHostV2['vision']['reviewImages']>,
  },
  maps: {
    retrieve: query => hostCall('maps', 'retrieve', query) as ReturnType<CapabilityHostV2['maps']['retrieve']>,
    render: request => hostCall('maps', 'render', request) as ReturnType<CapabilityHostV2['maps']['render']>,
  },
  svg: {
    validate: svg => hostCall('svg', 'validate', { svg }) as ReturnType<CapabilityHostV2['svg']['validate']>,
    inspect: svg => hostCall('svg', 'inspect', { svg }) as ReturnType<CapabilityHostV2['svg']['inspect']>,
    refine: request => hostCall('svg', 'refine', request) as Promise<string>,
  },
  models: {
    validate: asset => hostCall('models', 'validate', asset) as ReturnType<CapabilityHostV2['models']['validate']>,
    store: asset => hostCall('models', 'store', asset) as ReturnType<CapabilityHostV2['models']['store']>,
  },
  media: {
    validate: asset => hostCall('media', 'validate', asset) as ReturnType<CapabilityHostV2['media']['validate']>,
    store: asset => hostCall('media', 'store', asset) as ReturnType<CapabilityHostV2['media']['store']>,
  },
  subworker: { run: request => hostCall('subworker', 'run', request) },
  python: {
    ensureRuntime: runtimeId => hostCall('python', 'ensureRuntime', { runtimeId }) as ReturnType<CapabilityHostV2['python']['ensureRuntime']>,
    run: request => hostCall('python', 'run', request) as ReturnType<CapabilityHostV2['python']['run']>,
  },
  attachments: { store: request => hostCall('attachments', 'store', request) as ReturnType<CapabilityHostV2['attachments']['store']> },
  log: (level, message, detail) => post({ type: 'log', level, message, ...(detail ? { detail } : {}) }),
  get signal() { return currentCall.getStore()?.controller.signal ?? controller.signal; },
};

let worker: CapabilityWorkerV2 | null = null;
let capabilityId = '';

async function load(init: InitMessage): Promise<void> {
  capabilityId = init.capabilityId;
  const required = createRequire(init.entryPath)(init.entryPath) as { default?: CapabilityWorkerFactory } | CapabilityWorkerFactory;
  const factory = typeof required === 'function' ? required : required.default;
  if (typeof factory !== 'function') throw new Error('The capability entry must export a worker factory.');
  worker = await factory(host);
  if (!worker || typeof worker.invoke !== 'function' || typeof worker.health !== 'function' || typeof worker.renderArtifact !== 'function' || typeof worker.shutdown !== 'function') {
    throw new Error('The capability entry did not return a complete worker.');
  }
  post({ type: 'ready', protocol: TRUSTED_PROTOCOL, capabilityId });
}

port.on('message', event => {
  const raw = event.data as unknown;
  if (raw && typeof raw === 'object' && (raw as InitMessage).type === 'init') {
    const init = raw as InitMessage;
    void load(init).catch(error => {
      post({ type: 'result', callId: 'init', ok: false, error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
    return;
  }

  let message;
  try { message = validateHostToWorker(raw); }
  catch { return; }

  if (message.type === 'host-result') {
    const pending = pendingHostCalls.get(message.callId);
    if (!pending) return;
    pendingHostCalls.delete(message.callId);
    if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error));
    return;
  }

  if (message.type === 'cancel') {
    const cancelled = () => new DOMException('The capability call was cancelled.', 'AbortError');
    const only = message.invocationId;
    if (only) {
      // One call: its own work and its own host calls, and nothing that runs beside it.
      callControllers.get(only)?.abort(cancelled());
      for (const [id, pending] of pendingHostCalls) {
        if (pending.parent !== only) continue;
        pendingHostCalls.delete(id);
        pending.reject(cancelled());
      }
      return;
    }
    controller.abort(cancelled());
    for (const [, call] of callControllers) call.abort(cancelled());
    // Every host call in flight is dead too: its answer can no longer be used.
    for (const [, pending] of pendingHostCalls) pending.reject(cancelled());
    pendingHostCalls.clear();
    controller = new AbortController();
    return;
  }

  if (message.type === 'shutdown') {
    void Promise.resolve(worker?.shutdown()).catch(() => {}).finally(() => process.exit(0));
    return;
  }

  const { callId, method, payload } = message;
  const call = { callId, controller: new AbortController() };
  callControllers.set(callId, call.controller);
  void currentCall.run(call, async () => {
    if (!worker) throw new Error('The capability worker is not loaded.');
    // Migrations are the package's, not the module's: they are the numbered scripts the
    // manifest declared, and they run here, one rung at a time, with the same host the
    // capability has at runtime. Keeping them out of the worker module is what stops a
    // package from quietly implementing `migrate` as a no-op while its `migrations/`
    // directory says otherwise.
    if (method === 'migrate') return runMigrations(payload as MigrationInputV1);
    const implementation = worker[method] as ((input: unknown) => Promise<unknown>) | undefined;
    // A method the manifest advertised but the module never implemented is an error the
    // caller can act on, not a silent undefined that looks like an empty result.
    if (typeof implementation !== 'function') throw new Error(`This capability does not implement ${method}.`);
    return implementation.call(worker, payload);
  }).finally(() => callControllers.delete(callId)).then(
    // A value the port cannot clone (a function, a class with private state) throws here, and
    // unhandled that rejection ended the process — and every other call it was carrying. It is
    // this call's failure, and it is reported as one.
    value => {
      try { post({ type: 'result', callId, ok: true, value }); }
      catch (error) { post({ type: 'result', callId, ok: false, error: `The capability's result could not be sent to the application: ${error instanceof Error ? error.message : String(error)}` }); }
    },
    error => post({
      type: 'result', callId, ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.name === 'AbortError' ? { code: 'cancelled' } : {}),
    }),
  );
});

/** Climbs the data version ladder, stopping at the first rung that fails.
 *
 *  Each script moves the data from version n-1 to n and is expected to be idempotent: a
 *  retry re-runs only the rung that did not finish. Nothing is reported as migrated that
 *  did not complete, so the host persists a version the data actually has — a half-applied
 *  step that claimed success is how a profile ends up believing it holds data it lost. */
async function runMigrations(input: MigrationInputV1): Promise<MigrationResultV1> {
  if (!input || !Array.isArray(input.scripts)) throw new Error('Malformed migration request.');
  const notes: string[] = [];
  let reached = input.fromDataVersion;

  for (let rung = input.fromDataVersion; rung < input.scripts.length; rung++) {
    const file = input.scripts[rung];
    try {
      const loaded = createRequire(file)(file) as { default?: MigrationScriptV1 } | MigrationScriptV1;
      const script = typeof loaded === 'function' ? loaded : loaded.default;
      if (typeof script !== 'function') throw new Error('A migration must export a function.');
      const result = await script({ host, legacy: input.legacy, fromDataVersion: rung, toDataVersion: rung + 1 });
      if (result?.notes) notes.push(String(result.notes).slice(0, 500));
      reached = rung + 1;
    } catch (error) {
      return {
        dataVersion: reached,
        ...(notes.length ? { notes: notes.join(' ') } : {}),
        failed: `${file.split('/').pop()}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
      };
    }
  }
  return { dataVersion: reached, ...(notes.length ? { notes: notes.join(' ') } : {}) };
}
