import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { Semaphore } from './hostLimits';
import type { TrustedWorkerRuntime } from './workerHost';

/** A capability's subworkers: auxiliary processes from the package's own bundle, each with its
 *  own deadline and a kill the host controls. They talk to nothing: one input in, one value out.
 *
 *  A subworker used to be forked for every request and killed after its answer. The chemistry
 *  validator loads RDKit and OpenChemLib as WebAssembly before it can parse anything, and that
 *  load was measured at 1.05 s of a 1.09 s inspection — paid again by every resolve pass, route
 *  audit, structure check and step drawing of every round. A process that answered cleanly is now
 *  kept for the next request to the same entry; one that timed out, was cancelled, failed to answer
 *  or exited is killed and never reused, so a stuck validation still costs one process.
 *
 *  `subworkers.max` is enforced here: at most that many of a capability's subworkers run at once,
 *  across every turn. A request that waits for a slot is not charged for the wait. */

interface PooledSubworker {
  key: string;
  child: UtilityProcess;
  uses: number;
  idle?: NodeJS.Timeout;
  onMessage?: (message: { error?: string; result?: unknown }) => void;
  onExit?: () => void;
}

/** Retired after this long unused: long enough to span the model's turn between the checks of one
 *  answer, short enough that an idle application holds no WebAssembly heaps. */
const SUBWORKER_IDLE_MS = 120_000;
/** Retired after this many answers, so memory a library never frees stays bounded. */
const SUBWORKER_MAX_USES = 100;

const slots = new Map<string, Semaphore>();
const idle = new Map<string, PooledSubworker[]>();

const capabilityKey = (runtime: TrustedWorkerRuntime) => `${runtime.plugin.id}/${runtime.capabilityId}@${runtime.plugin.version}+${runtime.plugin.digest}`;

/** Stops the kept subworkers of the capabilities the predicate names, or of all of them. */
export function stopCapabilitySubworkers(predicate?: (runtimeKey: string) => boolean): void {
  for (const [key, list] of [...idle]) {
    if (predicate && !predicate(key)) continue;
    for (const pooled of [...list]) retire(pooled);
    idle.delete(key);
  }
}

function retire(pooled: PooledSubworker): void {
  if (pooled.idle) clearTimeout(pooled.idle);
  const list = idle.get(pooled.key);
  if (list?.includes(pooled)) list.splice(list.indexOf(pooled), 1);
  pooled.onMessage = pooled.onExit = undefined;
  try { pooled.child.kill(); } catch { /* already gone */ }
}

function park(pooled: PooledSubworker, limit: number): void {
  pooled.onMessage = pooled.onExit = undefined;
  const list = idle.get(pooled.key) ?? [];
  if (pooled.uses >= SUBWORKER_MAX_USES || list.length >= limit) { retire(pooled); return; }
  list.push(pooled);
  idle.set(pooled.key, list);
  pooled.idle = setTimeout(() => retire(pooled), SUBWORKER_IDLE_MS);
  pooled.idle.unref?.();
}

function fork(runtime: TrustedWorkerRuntime, entry: string, key: string): PooledSubworker {
  const child = utilityProcess.fork(entry, [], { serviceName: `Nodus capability subworker ${runtime.capabilityId}`, stdio: 'ignore' });
  const pooled: PooledSubworker = { key, child, uses: 0 };
  child.on('message', (message: { error?: string; result?: unknown }) => pooled.onMessage?.(message));
  child.once('error', () => { const onExit = pooled.onExit; retire(pooled); onExit?.(); });
  child.once('exit', () => { const onExit = pooled.onExit; retire(pooled); onExit?.(); });
  return pooled;
}

export async function runCapabilitySubworker(runtime: TrustedWorkerRuntime, request: { entry: string; input: unknown; timeoutMs: number }, signal: AbortSignal): Promise<unknown> {
  const entry = path.resolve(path.dirname(runtime.entryPath), request.entry);
  const base = path.resolve(path.dirname(runtime.entryPath));
  if (entry !== base && !entry.startsWith(base + path.sep)) throw new Error('A subworker entry must live inside its own package.');
  const max = runtime.permissions.subworkers?.max ?? 0;
  if (max < 1) throw new Error('Capability subworkers are not permitted.');
  const capability = capabilityKey(runtime);
  let gate = slots.get(capability);
  if (!gate) { gate = new Semaphore(max); slots.set(capability, gate); }
  const queuedAt = performance.now();
  const release = await gate.acquire(signal);
  const queued = performance.now() - queuedAt;
  const key = `${capability}:${entry}`;
  let pooled: PooledSubworker | undefined;
  for (const candidate of idle.get(key) ?? []) { pooled = candidate; break; }
  const reused = Boolean(pooled);
  if (pooled) {
    if (pooled.idle) clearTimeout(pooled.idle);
    idle.get(key)!.splice(idle.get(key)!.indexOf(pooled), 1);
  } else {
    pooled = fork(runtime, entry, key);
  }
  const target = pooled;
  // Same reason as the tool budget: "the capability subworker exceeded its time limit" named no
  // number and no cause. The work it bounds was measured at a third of a second against a budget
  // of fifteen, so an overrun is a starved or unstarted process rather than a hard molecule — and
  // that is only visible with the start-to-result time written down. The budget starts once the
  // request has its slot; time spent queued is logged beside it, not charged to it.
  // Both clocks on purpose. performance.now() is monotonic, so a duration measured with it
  // survives an NTP correction or a sleep; Date.now() is kept beside it as a cross-check,
  // because a disagreement between the two IS the finding — it says the wall clock moved
  // under the measurement, and a number taken from it should not be trusted. Two timing
  // calls cost nothing against a subprocess spawn.
  const spawned = performance.now();
  const spawnedWall = Date.now();
  const budget = Math.min(Math.max(request.timeoutMs, 1_000), 300_000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: unknown, reusable = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (reusable) { target.uses += 1; park(target, max); } else retire(target);
      release();
      const spent = performance.now() - spawned;
      const wallSpent = Date.now() - spawnedWall;
      const drift = Math.abs(wallSpent - spent) > Math.max(250, spent * 0.1) ? ` · CLOCK STEPPED: wall says ${(wallSpent / 1000).toFixed(1)}s` : '';
      const context = `${reused ? ' · reused' : ' · started'}${queued >= 50 ? ` · queued ${(queued / 1000).toFixed(1)}s` : ''}`;
      // Always, and with the reason. Logging only past half the budget hid the useful case:
      // on one measured run 12 of 13 of these failed, most of them well inside the budget, so
      // they were not timeouts — and the line said nothing about what had gone wrong. The
      // drawing path degrades silently, so a route can verify while almost every structure
      // validation fails, and nothing anywhere records it.
      console.info(`${new Date().toISOString()} [capability] ${runtime.capabilityId} subworker ${request.entry} ${error ? 'failed' : 'ok'} in ${(spent / 1000).toFixed(1)}s of a ${(budget / 1000).toFixed(0)}s budget${context}${error ? ` — ${error.message.replace(/\s+/g, ' ').slice(0, 200)}` : ''}${drift}`);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new DOMException('The capability subworker was cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(`The capability subworker exceeded its time limit of ${(budget / 1000).toFixed(0)} seconds.`)), budget);
    signal.addEventListener('abort', abort, { once: true });
    // An answer, even a refusal, leaves the process as able as it was; anything else does not.
    target.onMessage = message => {
      if (message?.error) finish(new Error(String(message.error).slice(0, 2_000)), undefined, true);
      else finish(undefined, message?.result, true);
    };
    target.onExit = () => finish(new Error('The capability subworker exited without a result.'));
    try { target.child.postMessage(request.input); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
