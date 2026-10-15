/** Paid transports must never turn a pending edit or a failed poll into a hot loop. */
export const CLOUDFLARE_SYNC_INTERVAL_MS = 60_000;
export const CLOUDFLARE_MAX_CONSECUTIVE_FAILURES = 5;
export const CLOUDFLARE_MAX_PAGES_PER_PASS = 8;

export interface CloudflareGateState { failures: number; nextAttemptAt: number; stopped: boolean }
let persistence: { read(key: string): CloudflareGateState | undefined; write(key: string, state: CloudflareGateState): void } | undefined;
export function configureCloudflareGatePersistence(adapter: NonNullable<typeof persistence>): void { persistence = adapter; gates.clear(); }

export class CloudflareSyncGate {
  private running = false;
  private failures = 0;
  private nextAttemptAt = 0;
  private stopped = false;

  constructor(private readonly checkpoint?: (state: CloudflareGateState) => void, state?: CloudflareGateState) {
    if (state) { this.failures = state.failures; this.nextAttemptAt = state.nextAttemptAt; this.stopped = state.stopped; }
  }
  private save(): void { this.checkpoint?.({ failures: this.failures, nextAttemptAt: this.nextAttemptAt, stopped: this.stopped }); }

  ready(now = Date.now()): boolean {
    return !this.running && !this.stopped && now >= this.nextAttemptAt;
  }

  begin(force = false, now = Date.now()): boolean {
    if (this.running || (!force && !this.ready(now))) return false;
    if (force) this.resume();
    this.running = true;
    this.nextAttemptAt = now + CLOUDFLARE_SYNC_INTERVAL_MS;
    this.save();
    return true;
  }

  finish(failed = false, status?: number, now = Date.now()): void {
    this.running = false;
    if (!failed) { this.failures = 0; this.save(); return; }
    this.failures += 1;
    this.stopped = this.failures >= CLOUDFLARE_MAX_CONSECUTIVE_FAILURES
      || status === 401 || status === 403 || status === 429 || status === 426;
    this.nextAttemptAt = Math.max(this.nextAttemptAt,
      now + Math.min(15 * 60_000, CLOUDFLARE_SYNC_INTERVAL_MS * 2 ** (this.failures - 1)));
    this.save();
  }

  get paused(): boolean { return this.stopped; }

  resume(): void { this.failures = 0; this.stopped = false; this.nextAttemptAt = 0; this.save(); }
}

const gates = new Map<string, CloudflareSyncGate>();
/** Timer restarts retain the breaker. A new credential or explicit manual action resumes it. */
export function cloudflareSyncGate(lane: string, url: string, token: string): CloudflareSyncGate {
  const key = JSON.stringify([lane, url.replace(/\/+$/, ''), token]);
  let gate = gates.get(key);
  if (!gate) { gate = new CloudflareSyncGate(persistence ? (state) => persistence!.write(key, state) : undefined, persistence?.read(key)); gates.set(key, gate); }
  return gate;
}

export function advancingCloudflareCursor(previous: number, next: unknown, hasMore: boolean): number {
  if (!Number.isSafeInteger(next) || Number(next) < previous || (hasMore && Number(next) <= previous)) {
    throw new Error('Cloudflare devolvió una página sin avanzar el cursor. Se ha detenido la sincronización.');
  }
  return Number(next);
}
