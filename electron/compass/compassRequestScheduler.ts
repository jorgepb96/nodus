import { createHash } from "node:crypto";
import type {
  CompassProviderId,
  CompassProviderPage,
  CompassQueryStrategy,
} from "@shared/compass";

export interface CompassProviderUsage {
  provider: CompassProviderId;
  day: string;
  dailyUsed: number;
  tokens: number;
  tokenUpdatedAt: number;
  nextAllowedAt: number;
  consecutiveFailures: number;
  circuitUntil?: number;
  retryAt?: number;
}
export interface CompassUsageStore {
  getProviderUsage(provider: CompassProviderId): CompassProviderUsage | null;
  saveProviderUsage(usage: CompassProviderUsage): void;
}
export class CompassScheduleError extends Error {
  constructor(
    message: string,
    readonly state:
      "budget-exhausted" | "temporarily-disabled" | "rate-limited",
  ) {
    super(message);
    this.name = "CompassScheduleError";
  }
}
interface Limit {
  capacity: number;
  refillPerMs: number;
  minIntervalMs: number;
  daily?: number;
}
interface Task {
  key: string;
  provider: CompassProviderId;
  searchId: string;
  priority: number;
  signal: AbortSignal;
  run: (signal: AbortSignal) => Promise<CompassProviderPage>;
  resolve: (page: CompassProviderPage) => void;
  reject: (error: unknown) => void;
}
interface InflightRequest {
  promise: Promise<CompassProviderPage>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}
const DAY = () => new Date().toISOString().slice(0, 10);
const limits: Partial<Record<CompassProviderId, Limit>> = {
  openalex: {
    capacity: 1,
    refillPerMs: 1 / 1_000,
    minIntervalMs: 1_000,
    daily: 60,
  },
  core: { capacity: 5, refillPerMs: 5 / 10_000, minIntervalMs: 0 },
  openlibrary: { capacity: 1, refillPerMs: 1 / 1_000, minIntervalMs: 1_000 },
  loc: { capacity: 1, refillPerMs: 1 / 1_000, minIntervalMs: 1_000 },
  doaj: { capacity: 1, refillPerMs: 1 / 1_000, minIntervalMs: 1_000 },
  datacite: { capacity: 1, refillPerMs: 1 / 1_000, minIntervalMs: 1_000 },
  dblp: { capacity: 1, refillPerMs: 1 / 1_000, minIntervalMs: 1_000 },
  internetarchive: {
    capacity: 1,
    refillPerMs: 1 / 1_000,
    minIntervalMs: 1_000,
  },
  zenodo: { capacity: 30, refillPerMs: 30 / 60_000, minIntervalMs: 0 },
  arxiv: { capacity: 1, refillPerMs: 1 / 3_000, minIntervalMs: 3_000 },
};
const defaultLimit: Limit = {
  capacity: 2,
  refillPerMs: 2 / 1_000,
  minIntervalMs: 250,
};

export class CompassRequestScheduler {
  private readonly queue: Task[] = [];
  private readonly activeProviders = new Set<CompassProviderId>();
  private readonly activeBySearch = new Map<string, number>();
  private readonly inflight = new Map<string, InflightRequest>();
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly store: CompassUsageStore) {}

  schedule(input: {
    provider: CompassProviderId;
    searchId: string;
    strategy: CompassQueryStrategy;
    fingerprint: string;
    cursor?: string;
    filters: unknown;
    priority?: "visible" | "load-more" | "prefetch";
    signal: AbortSignal;
    run: (signal: AbortSignal) => Promise<CompassProviderPage>;
  }): Promise<CompassProviderPage> {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          input.provider,
          input.strategy,
          input.fingerprint,
          input.filters,
          input.cursor ?? "*",
        ]),
      )
      .digest("hex");
    const existing = this.inflight.get(key);
    // An entry whose last consumer left has already been aborted but stays in the map until
    // its promise settles. Joining it would hand a fresh search an AbortError it never asked for.
    if (existing && !existing.controller.signal.aborted)
      return this.subscribe(existing, input.signal);
    const controller = new AbortController();
    const priority =
      input.priority === "visible" ? 0 : input.priority === "load-more" ? 1 : 2;
    const promise = new Promise<CompassProviderPage>((resolve, reject) => {
      const task: Task = {
        key,
        provider: input.provider,
        searchId: input.searchId,
        priority,
        signal: controller.signal,
        run: input.run,
        resolve,
        reject,
      };
      if (controller.signal.aborted)
        reject(new DOMException("Aborted", "AbortError"));
      else {
        controller.signal.addEventListener(
          "abort",
          () => {
            const index = this.queue.indexOf(task);
            if (index >= 0) {
              this.queue.splice(index, 1);
              reject(new DOMException("Aborted", "AbortError"));
            }
          },
          { once: true },
        );
        this.queue.push(task);
        this.queue.sort((left, right) => left.priority - right.priority);
        this.pump();
      }
    }) as Promise<CompassProviderPage>;
    const entry: InflightRequest = {
      promise,
      controller,
      consumers: 0,
      settled: false,
    };
    this.inflight.set(key, entry);
    void promise.finally(() => {
      entry.settled = true;
      if (this.inflight.get(key) === entry) this.inflight.delete(key);
    }).catch(() => undefined);
    return this.subscribe(entry, input.signal);
  }
  private subscribe(
    entry: InflightRequest,
    signal: AbortSignal,
  ): Promise<CompassProviderPage> {
    entry.consumers += 1;
    return new Promise((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", aborted);
        entry.consumers = Math.max(0, entry.consumers - 1);
        if (!entry.settled && entry.consumers === 0) entry.controller.abort();
      };
      const aborted = () => {
        release();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) {
        aborted();
        return;
      }
      signal.addEventListener("abort", aborted, { once: true });
      void entry.promise.then(
        (page) => {
          if (finished) return;
          release();
          resolve(page);
        },
        (error) => {
          if (finished) return;
          release();
          reject(error);
        },
      );
    });
  }
  private usage(
    provider: CompassProviderId,
    now: number,
  ): { usage: CompassProviderUsage; limit: Limit } {
    const limit = limits[provider] ?? defaultLimit;
    let usage = this.store.getProviderUsage(provider);
    if (!usage || usage.day !== DAY())
      usage = {
        provider,
        day: DAY(),
        dailyUsed: 0,
        tokens: limit.capacity,
        tokenUpdatedAt: now,
        nextAllowedAt: 0,
        consecutiveFailures: 0,
      };
    usage.tokens = Math.min(
      limit.capacity,
      usage.tokens +
        Math.max(0, now - usage.tokenUpdatedAt) * limit.refillPerMs,
    );
    usage.tokenUpdatedAt = now;
    return { usage, limit };
  }
  private waitFor(
    provider: CompassProviderId,
    now: number,
  ): {
    wait: number;
    usage: CompassProviderUsage;
    limit: Limit;
    error?: CompassScheduleError;
  } {
    const { usage, limit } = this.usage(provider, now);
    if (usage.circuitUntil && usage.circuitUntil > now)
      return {
        wait: usage.circuitUntil - now,
        usage,
        limit,
        error: new CompassScheduleError(
          "Compass provider circuit is temporarily open.",
          "temporarily-disabled",
        ),
      };
    if (limit.daily && usage.dailyUsed >= limit.daily)
      return {
        wait: new Date(`${DAY()}T23:59:59.999Z`).getTime() - now,
        usage,
        limit,
        error: new CompassScheduleError(
          "Anonymous daily provider budget is exhausted.",
          "budget-exhausted",
        ),
      };
    const tokenWait =
      usage.tokens >= 1 ? 0 : Math.ceil((1 - usage.tokens) / limit.refillPerMs);
    return {
      wait: Math.max(
        0,
        usage.nextAllowedAt - now,
        usage.retryAt ? usage.retryAt - now : 0,
        tokenWait,
      ),
      usage,
      limit,
    };
  }
  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    let nearest = Infinity;
    while (this.active < 4) {
      const now = Date.now();
      let chosen = -1;
      for (let index = 0; index < this.queue.length; index += 1) {
        const task = this.queue[index];
        if (
          task.signal.aborted ||
          this.activeProviders.has(task.provider) ||
          (this.activeBySearch.get(task.searchId) ?? 0) >= 3
        )
          continue;
        const gate = this.waitFor(task.provider, now);
        if (gate.error) {
          this.queue.splice(index, 1);
          index -= 1;
          task.reject(gate.error);
          continue;
        }
        if (gate.wait > 0) {
          nearest = Math.min(nearest, gate.wait);
          continue;
        }
        chosen = index;
        break;
      }
      if (chosen < 0) break;
      const [task] = this.queue.splice(chosen, 1);
      this.start(task);
    }
    if (this.queue.length && Number.isFinite(nearest))
      this.timer = setTimeout(
        () => this.pump(),
        Math.max(10, Math.min(nearest, 60_000)),
      );
  }
  private start(task: Task): void {
    const now = Date.now();
    const gate = this.waitFor(task.provider, now);
    const usage = gate.usage;
    usage.tokens = Math.max(0, usage.tokens - 1);
    usage.dailyUsed += 1;
    usage.nextAllowedAt = now + gate.limit.minIntervalMs;
    this.store.saveProviderUsage(usage);
    this.active += 1;
    this.activeProviders.add(task.provider);
    this.activeBySearch.set(
      task.searchId,
      (this.activeBySearch.get(task.searchId) ?? 0) + 1,
    );
    void task
      .run(task.signal)
      .then(
        (value) => {
          const current = this.usage(task.provider, Date.now()).usage;
          current.consecutiveFailures = 0;
          current.circuitUntil = undefined;
          current.retryAt = undefined;
          this.store.saveProviderUsage(current);
          task.resolve(value);
        },
        (error) => {
          // A cancelled request says nothing about the provider. Counting it would let three
          // cancels (or lane switches) open the circuit and refuse the next real search.
          if (task.signal.aborted || (error as { name?: unknown })?.name === "AbortError") {
            task.reject(error);
            return;
          }
          const current = this.usage(task.provider, Date.now()).usage;
          current.consecutiveFailures += 1;
          const retryAt = Number((error as { retryAt?: number })?.retryAt);
          if (Number.isFinite(retryAt)) current.retryAt = retryAt;
          if (current.consecutiveFailures >= 3)
            current.circuitUntil = Date.now() + 5 * 60_000;
          this.store.saveProviderUsage(current);
          task.reject(error);
        },
      )
      .finally(() => {
        this.active -= 1;
        this.activeProviders.delete(task.provider);
        const remaining = (this.activeBySearch.get(task.searchId) ?? 1) - 1;
        if (remaining) this.activeBySearch.set(task.searchId, remaining);
        else this.activeBySearch.delete(task.searchId);
        this.pump();
      });
  }
}
