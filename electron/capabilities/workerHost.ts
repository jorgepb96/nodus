import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { LIMITS, TRUSTED_PROTOCOL } from '../../packages/capability-api/src/limits';
import { validateWorkerToHost, type HostChannel, type HostToWorkerMessage, type WorkerMethod } from '../../packages/capability-api/src/protocol';
import type { CapabilityManifestV2 } from '../../packages/capability-api/src/manifest';
import type { TrustedPermissionSetV2 } from '../../packages/capability-api/src/permissions';
import { stopCapabilitySubworkers } from './subworkerPool';
import { Semaphore } from './hostLimits';

/** Runs one trusted capability in its own utility process.
 *
 *  This buys fault isolation, a deadline and a kill switch — not a security boundary.
 *  The signature is what makes running this code acceptable; the process only makes a
 *  hang or a crash survivable. */

export interface TrustedWorkerRuntime {
  capabilityId: string;
  plugin: { id: string; version: string; digest: string };
  manifest: CapabilityManifestV2;
  /** Absolute path to the package's worker bundle, inside the installed version. */
  entryPath: string;
  permissions: TrustedPermissionSetV2;
}

/** Everything the worker may ask the host to do, already permission-gated. */
export type CapabilityHostServices = (call: {
  runtime: TrustedWorkerRuntime;
  channel: HostChannel;
  method: string;
  payload: unknown;
  signal: AbortSignal;
}) => Promise<unknown>;

export interface CapabilityWorkerLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  detail?: Record<string, string | number | boolean>;
}

export interface CapabilityWorkerHandleOptions {
  /** A turn's services carry its owner and budget; never reuse them across turns. */
  scopeKey?: string;
  services: CapabilityHostServices;
  onLog?: (runtime: TrustedWorkerRuntime, entry: CapabilityWorkerLog) => void;
  /** Overridable so tests can run the bootstrap without a packaged build. */
  bootstrapPath?: string;
}

/** How long a worker has to finish its handshake, counted from the moment it exists. */
const READY_TIMEOUT_MS = 20_000;
/** Backstop for a handle that never settles at all. Deliberately far larger than the
 *  readiness budget: the time before `spawn` belongs to the host, not to the worker. */
const SPAWN_CEILING_MS = 120_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  /** The services of the turn that made this call: its host calls are answered with these. */
  services: CapabilityHostServices;
  /** Aborted when this call, and only this call, is cancelled or runs out of time. */
  controller: AbortController;
}

/** What a call may bring of its own. */
export interface CapabilityCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** The turn's services for this call's host calls; the handle's own when absent. */
  services?: CapabilityHostServices;
  /** Admission: at most `limit` calls with this key run at once in this worker (a tool's
   *  manifest `concurrency`). The deadline starts when the call is admitted. */
  queue?: { key: string; limit: number };
  /** Called once the call is admitted, with how long it waited. */
  onAdmitted?: (waitedMs: number) => void;
}

/** A start that failed before the worker said anything at all.
 *
 *  The module never ran, so this is not a verdict about the package: a main process busy
 *  enough for long enough — a launch, typically — loses the new utility process before it
 *  finishes starting, and it exits having reported nothing. Worth one more attempt once the
 *  host is free. A module that does load and then fails says so through its init result,
 *  and that answer is final. */
class WorkerStartFailure extends Error {}

/** The worker died with the call unanswered, having produced nothing for it. */
class WorkerLostCall extends Error {}

/** Methods that may simply be asked again.
 *
 *  A worker lost before it answers has done an unknown amount of work, so repeating a call
 *  is only safe where repeating it is meaningless. These read the worker's own state or
 *  render something already stored; `migrate` belongs here because each rung of the ladder
 *  is written to be re-runnable and the host records only what the worker reports finished.
 *  `invoke`, `applySettings` and `runAction` are deliberately absent: they are the ones
 *  whose second execution is a second execution. */
const REPEATABLE_METHODS: ReadonlySet<WorkerMethod> = new Set<WorkerMethod>([
  'health', 'getSettings', 'renderArtifact', 'renderLegacyResult', 'projectArtifactForModel', 'migrate',
]);

export class CapabilityWorkerHandle {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  /** Calls the host has given up on and asked the worker to stop, until it confirms. */
  private readonly cancelling = new Map<string, NodeJS.Timeout>();
  private abort = new AbortController();
  private killTimer: NodeJS.Timeout | null = null;
  private nextCallId = 0;
  /** Callers waiting for this worker to finish starting. */
  private starting = 0;
  private readonly queues = new Map<string, Semaphore>();

  constructor(private readonly runtime: TrustedWorkerRuntime, private readonly options: CapabilityWorkerHandleOptions) {}

  get alive(): boolean { return this.child !== null; }

  /** One attempt, and one retry for the failures that are the host's fault.
   *
   *  A main process that stalls long enough loses the utility process it just asked for:
   *  measured on a real profile, a stall of around twenty seconds leaves the child either
   *  never spawning or spawning, completing its handshake and being torn down in the same
   *  millisecond. Neither is the package refusing to work, and neither should be reported
   *  to the user as a capability that will not start. The failed attempt has already
   *  cleared the handle, so the retry forks afresh — against a host that is by then free.
   *
   *  Exactly one, and only for work that may be repeated: a retry that hides a worker
   *  which genuinely cannot come up, or that runs a tool twice, is worse than the error. */
  async call<T>(method: WorkerMethod, payload: unknown, options: CapabilityCallOptions = {}): Promise<T> {
    // A tool's declared concurrency is what this worker runs of it at once. It was declared in
    // every manifest and enforced nowhere. Waiting is abortable and is not charged to the call's
    // deadline, which `attempt` arms once the call has its slot and the worker is ready.
    const waited = performance.now();
    const release = options.queue ? await this.queueFor(options.queue).acquire(options.signal) : undefined;
    options.onAdmitted?.(performance.now() - waited);
    try {
      try { return await this.attempt<T>(method, payload, options); }
      catch (error) {
        const retryable = error instanceof WorkerStartFailure
          || (error instanceof WorkerLostCall && REPEATABLE_METHODS.has(method));
        if (!retryable) throw error;
        return await this.attempt<T>(method, payload, options);
      }
    } finally { release?.(); }
  }

  private queueFor(queue: { key: string; limit: number }): Semaphore {
    let semaphore = this.queues.get(queue.key);
    if (!semaphore) { semaphore = new Semaphore(queue.limit); this.queues.set(queue.key, semaphore); }
    return semaphore;
  }

  private async attempt<T>(method: WorkerMethod, payload: unknown, options: CapabilityCallOptions): Promise<T> {
    options.signal?.throwIfAborted();
    const ready = this.start();
    const signal = options.signal;
    let abortStart: (() => void) | undefined;
    this.starting += 1;
    try {
      if (!signal) await ready;
      else await Promise.race([ready, new Promise<never>((_resolve, reject) => {
        abortStart = () => {
          // The start belongs to every caller waiting on it: only the last one stops it.
          if (this.starting <= 1 && !this.pending.size) this.cancel();
          reject(new DOMException('The capability startup was cancelled.', 'AbortError'));
        };
        signal.addEventListener('abort', abortStart, { once: true });
        if (signal.aborted) abortStart();
      })]);
    } finally {
      this.starting -= 1;
      if (abortStart) signal?.removeEventListener('abort', abortStart);
    }
    // Abort can arrive with the ready frame, before the call listener has been installed.
    signal?.throwIfAborted();
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? LIMITS.toolTimeoutMsMax, LIMITS.toolTimeoutMsMin), LIMITS.toolTimeoutMsMax);
    const callId = `c${this.nextCallId++}`;
    return new Promise<T>((resolve, reject) => {
      const settle = (error?: Error, value?: unknown) => {
        const entry = this.pending.get(callId);
        if (!entry) return;
        this.pending.delete(callId);
        clearTimeout(entry.timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value as T);
      };
      // Cancellation and the deadline are this call's. They used to cancel the whole process —
      // every call it was carrying, then a kill two seconds later whatever happened — so one
      // tool past its budget failed the drawings, lookups and checks running beside it.
      const onAbort = () => { this.cancelCall(callId); settle(new DOMException('The capability call was cancelled.', 'AbortError')); };
      const timer = setTimeout(() => {
        // A call past its deadline is not asked politely twice: cancel it, then kill the
        // process if the call is still running when the grace period ends.
        this.cancelCall(callId);
        settle(new Error(`${this.runtime.capabilityId} exceeded ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      this.pending.set(callId, { resolve: value => settle(undefined, value), reject: error => settle(error), timer, services: options.services ?? this.options.services, controller: new AbortController() });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try { this.post({ type: 'call', callId, method, payload }); }
      catch (error) { settle(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  /** Stops one call. Its host calls in flight are aborted and any it makes later are refused; the
   *  worker is asked to abort that call alone; and the process is killed only if the call is still
   *  running when the grace period ends — a call stuck in synchronous work cannot be stopped any
   *  other way, and then nothing else in that process can be saved either. */
  private cancelCall(callId: string): void {
    this.pending.get(callId)?.controller.abort();
    if (!this.child || this.cancelling.has(callId)) return;
    try { this.post({ type: 'cancel', invocationId: callId }); } catch { /* the process is already gone */ }
    const timer = setTimeout(() => {
      this.cancelling.delete(callId);
      this.teardown(new Error(`${this.runtime.capabilityId} did not stop and was terminated.`));
    }, LIMITS.cancelGraceMs);
    timer.unref?.();
    this.cancelling.set(callId, timer);
  }

  /** Asks the worker to stop, then kills it if it does not. Pending calls are rejected
   *  either way: whatever the process is still doing, its answer is no longer wanted. */
  cancel(): void {
    this.abort.abort();
    if (!this.child) return;
    try { this.post({ type: 'cancel' }); } catch { /* the process is already gone */ }
    if (this.killTimer) return;
    this.killTimer = setTimeout(() => { this.killTimer = null; this.teardown(new Error(`${this.runtime.capabilityId} did not stop and was terminated.`)); }, LIMITS.cancelGraceMs);
    this.killTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (!this.child) return;
    try { this.post({ type: 'shutdown' }); } catch { /* already gone */ }
    const child = this.child;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => resolve(), LIMITS.cancelGraceMs);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.teardown(new Error(`${this.runtime.capabilityId} was stopped.`));
  }

  private post(message: HostToWorkerMessage): void {
    if (!this.child) throw new Error(`${this.runtime.capabilityId} is not running.`);
    this.child.postMessage(message);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    if (this.abort.signal.aborted) this.abort = new AbortController();
    const bootstrap = this.options.bootstrapPath ?? path.join(__dirname, 'capabilityWorkerBootstrap.js');
    const child = utilityProcess.fork(bootstrap, [], { serviceName: `Nodus capability ${this.runtime.capabilityId}`, stdio: 'ignore' });
    this.child = child;

    this.ready = new Promise<void>((resolve, reject) => {
      // The readiness budget is armed on `spawn`, never on `fork`.
      //
      // Timers and the child's messages are both delivered on the main process's own event
      // loop, and a launch can block that loop for longer than this deadline. Started at
      // fork, the budget is spent on the host's backlog rather than on the worker: when the
      // loop frees, libuv runs the timers phase before the I/O phase, so the deadline fires
      // first and a worker that had not yet been given the chance to spawn is reported as
      // one that would not start. Measured from `spawn`, it measures the worker.
      let timer = setTimeout(() => reject(new Error(`${this.runtime.capabilityId} did not spawn.`)), SPAWN_CEILING_MS);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      // Whether the worker ever got as far as saying something for itself — a handshake, or
      // a load error it wants reported. Until it does, an exit is the host's problem.
      let spoke = false;
      child.once('spawn', () => {
        clearTimeout(timer);
        timer = setTimeout(() => reject(new Error(`${this.runtime.capabilityId} did not start.`)), READY_TIMEOUT_MS);
      });
      child.on('message', raw => {
        let message;
        // A frame the host cannot parse is dropped, not acted on: the worker is
        // first-party but the port is still a boundary worth validating.
        try { message = validateWorkerToHost(raw); } catch { return; }
        if (message.type === 'ready') {
          spoke = true;
          if (message.protocol !== TRUSTED_PROTOCOL || message.capabilityId !== this.runtime.capabilityId) {
            fail(new Error(`${this.runtime.capabilityId} answered for a different capability.`));
            this.teardown(new Error('Handshake mismatch.'));
            return;
          }
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === 'result') {
          if (message.callId === 'init') { spoke = true; fail(new Error(message.ok ? 'The capability failed to load.' : message.error)); return; }
          // A cancelled call that has stopped: nothing is waiting for it, and nothing need be killed.
          const stopping = this.cancelling.get(message.callId);
          if (stopping) { clearTimeout(stopping); this.cancelling.delete(message.callId); return; }
          const pending = this.pending.get(message.callId);
          if (!pending) return;
          if (message.ok) pending.resolve(message.value);
          else pending.reject(message.code === 'cancelled' ? new DOMException(message.error, 'AbortError') : new Error(message.error));
          return;
        }
        // Written to the main log when nobody asked for them: no caller ever passed `onLog`, and a
        // worker has no other way out (its stdio is ignored), so every line a capability logged
        // about a fallback it took was dropped here.
        if (message.type === 'log') { (this.options.onLog ?? writeWorkerLog)(this.runtime, message); return; }
        if (message.type === 'host-call') void this.serveHostCall(message.callId, message.channel, message.method, message.payload, message.parentCallId);
      });
      child.once('error', error => { fail(new Error(String(error))); this.teardown(new Error(String(error))); });
      child.once('exit', code => {
        fail(spoke
          ? new Error(`${this.runtime.capabilityId} exited before it was ready (code ${code}).`)
          : new WorkerStartFailure(`${this.runtime.capabilityId} exited before it started (code ${code}).`));
        this.teardown(new Error(`${this.runtime.capabilityId} exited (code ${code}).`), true);
      });
      try { child.postMessage({ type: 'init', capabilityId: this.runtime.capabilityId, entryPath: this.runtime.entryPath }); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });

    // A failed start must not be remembered as the permanent state of this capability:
    // clearing the promise lets the next invocation spawn a fresh process.
    return this.ready.catch(error => { this.ready = null; throw error; });
  }

  private async serveHostCall(callId: string, channel: HostChannel, method: string, payload: unknown, parentCallId?: string): Promise<void> {
    const child = this.child;
    // Answered with the services, and under the cancellation, of the call that asked. A host call
    // whose call is over is refused rather than run: its turn no longer wants it.
    const owner = parentCallId ? this.pending.get(parentCallId) : undefined;
    if (parentCallId && !owner) {
      try { this.post({ type: 'host-result', callId, ok: false, error: 'The capability call this request belongs to has ended.' }); }
      catch { /* the worker is gone */ }
      return;
    }
    const signal = owner ? AbortSignal.any([owner.controller.signal, this.abort.signal]) : this.abort.signal;
    const services = owner?.services ?? this.options.services;
    try {
      const value = await services({ runtime: this.runtime, channel, method, payload, signal });
      if (signal.aborted || child !== this.child) return;
      this.post({ type: 'host-result', callId, ok: true, value });
    } catch (error) {
      if (signal.aborted || child !== this.child) return;
      try { this.post({ type: 'host-result', callId, ok: false, error: error instanceof Error ? error.message : String(error) }); }
      catch { /* the worker is gone; nothing is waiting for this answer */ }
    }
  }

  /** `lost` distinguishes a worker that died from one that was cancelled or stopped: the
   *  calls it was carrying were never refused, only dropped. */
  private teardown(reason: Error, lost = false): void {
    this.abort.abort();
    if (this.killTimer) { clearTimeout(this.killTimer); this.killTimer = null; }
    for (const [, timer] of this.cancelling) clearTimeout(timer);
    this.cancelling.clear();
    const child = this.child;
    this.child = null;
    this.ready = null;
    for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(lost ? new WorkerLostCall(reason.message) : reason); }
    this.pending.clear();
    try { child?.kill(); } catch { /* already gone */ }
  }
}

function writeWorkerLog(runtime: TrustedWorkerRuntime, entry: CapabilityWorkerLog): void {
  if (entry.level === 'debug') return;
  const detail = entry.detail && Object.keys(entry.detail).length ? ` ${JSON.stringify(entry.detail)}` : '';
  console[entry.level](`${new Date().toISOString()} [capability] ${runtime.capabilityId} ${entry.message}${detail}`);
}

const handles = new Map<string, CapabilityWorkerHandle>();

/** One live worker per capability and digest. A package that updates gets a new key, so
 *  a turn already running against the old digest keeps the process it started with.
 *
 *  The key starts with the PLUGIN id. It used to start with the capability id
 *  (`nodus:chemistry@…`), while every caller that retires a package's workers — approve, discard,
 *  roll back, remove, update — asked for the keys that contain the plugin id (`chemistry-studio`),
 *  so none of them ever stopped anything: the old version's processes outlived its update and
 *  its removal. */
export function acquireCapabilityWorker(runtime: TrustedWorkerRuntime, options: CapabilityWorkerHandleOptions): CapabilityWorkerHandle {
  const key = `${runtime.plugin.id}/${runtime.capabilityId}@${runtime.plugin.version}+${runtime.plugin.digest}${options.scopeKey ? `#${options.scopeKey}` : ''}`;
  const existing = handles.get(key);
  if (existing) return existing;
  const handle = new CapabilityWorkerHandle(runtime, options);
  handles.set(key, handle);
  return handle;
}

/** Every worker and kept subworker of one plugin, whatever version, digest or turn. */
export async function stopPluginWorkers(pluginId: string): Promise<void> {
  const owned = (key: string) => key.startsWith(`${pluginId}/`);
  stopCapabilitySubworkers(owned);
  await stopCapabilityWorkers(owned);
}

/** A scope's workers are shared by every runner that names it — an answer's evidence gather, its
 *  route checks and its correction rounds — and live while one of them is open, then this long,
 *  so the next phase finds the process, its module caches and its request pacing still there. */
const SCOPE_IDLE_MS = 10 * 60_000;
/** A scope older than this starts afresh at its next lease rather than carrying a worker's
 *  caches indefinitely. */
const SCOPE_MAX_AGE_MS = 60 * 60_000;
/** Idle scopes kept at once; the oldest is stopped first. */
const SCOPE_IDLE_MAX = 4;

interface ScopeLease { key: string; count: number; created: number; idle?: NodeJS.Timeout; idleSince?: number }
const scopes = new Map<string, ScopeLease>();
let scopeGeneration = 0;

const stopScope = (lease: ScopeLease) => {
  if (lease.idle) clearTimeout(lease.idle);
  for (const [name, candidate] of scopes) if (candidate === lease) scopes.delete(name);
  return stopCapabilityWorkers(key => key.endsWith(`#${lease.key}`));
};

/** Opens a lease on a scope's workers and returns the scope key to acquire them with, and the
 *  release. Without a scope name the lease is the runner's own and its workers stop on release,
 *  as every runner's did before scopes existed. */
export function leaseCapabilityScope(scope?: string, options: { idleMs?: number } = {}): { scopeKey: string; release: () => Promise<void> } {
  if (!scope) {
    const lease: ScopeLease = { key: `runner-${++scopeGeneration}-${Date.now().toString(36)}`, count: 1, created: Date.now() };
    let released = false;
    return { scopeKey: lease.key, release: async () => { if (released) return; released = true; await stopScope(lease); } };
  }
  let lease = scopes.get(scope);
  if (lease && !lease.count && Date.now() - lease.created > SCOPE_MAX_AGE_MS) { void stopScope(lease); lease = undefined; }
  if (!lease) {
    lease = { key: `scope-${++scopeGeneration}`, count: 0, created: Date.now() };
    scopes.set(scope, lease);
  }
  if (lease.idle) { clearTimeout(lease.idle); lease.idle = lease.idleSince = undefined; }
  lease.count += 1;
  const held = lease;
  let released = false;
  return {
    scopeKey: held.key,
    release: async () => {
      if (released) return;
      released = true;
      held.count -= 1;
      if (held.count > 0) return;
      const idleMs = options.idleMs ?? SCOPE_IDLE_MS;
      if (idleMs <= 0) { await stopScope(held); return; }
      held.idleSince = Date.now();
      held.idle = setTimeout(() => { void stopScope(held); }, idleMs);
      held.idle.unref?.();
      const waiting = [...new Set(scopes.values())].filter(candidate => !candidate.count && candidate.idleSince !== undefined).sort((a, b) => a.idleSince! - b.idleSince!);
      for (const oldest of waiting.slice(0, Math.max(0, waiting.length - SCOPE_IDLE_MAX))) await stopScope(oldest);
    },
  };
}

export async function stopCapabilityWorkers(predicate?: (key: string) => boolean): Promise<void> {
  for (const [key, handle] of [...handles]) {
    if (predicate && !predicate(key)) continue;
    handles.delete(key);
    await handle.stop();
  }
}
