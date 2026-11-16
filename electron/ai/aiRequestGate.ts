import type { AiConcurrencySnapshot } from '@shared/types';

export type AiRequestClass = 'interactive' | 'background' | 'fusion' | 'embedding';

/**
 * The scheduling class of an embedding request.
 *
 * A question's embedding has a person waiting on it; a preparation batch does not. On a
 * model that runs on this computer both share one scheduler lane (a single slot unless
 * calibrated otherwise), and as plain `embedding` requests they were served in arrival
 * order: a question asked while documents were being indexed waited behind every batch
 * already queued, which on a long document is minutes of "Preparing search". Marking it
 * interactive lets it go next, so it waits at most for the batch already running.
 *
 * Remote providers keep `embedding`: there the interactive class also clamps the
 * account's concurrency, which would slow every indexing batch for one question.
 */
export function embeddingRequestClass(provider: string, role?: string): AiRequestClass {
  const local = provider === 'nodus' || provider === 'ollama' || provider === 'lmstudio';
  return role === 'query' && local ? 'interactive' : 'embedding';
}

export interface AiRequestDescriptor {
  provider: string;
  model: string;
  /** Opaque, non-secret identifier for the credential/quota scope. */
  credentialScope: string;
  endpoint?: string | null;
  requestClass: AiRequestClass;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  signal?: AbortSignal;
  jobId?: string;
}

export interface AiConcurrencyPolicy {
  mode: 'automatic' | 'manual';
  initial: number;
  maximum: number;
  manualLimit: number;
}

type WaitingRequest<T = unknown> = {
  descriptor: AiRequestDescriptor;
  /** Captured while the caller's vault/database context is still valid. */
  policy: AiConcurrencyPolicy;
  sequence: number;
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
  abort?: () => void;
};

type AdaptiveState = {
  mode: 'automatic' | 'manual';
  active: number;
  currentLimit: number;
  maximumLimit: number;
  successStreak: number;
  lastThrottleAt: number;
  lastIncreaseAt: number;
  cooldownUntil: number;
  transientFailures: number[];
  latencies: number[];
  lastChangeReason: string;
  remainingRequests: number | null;
  remainingTokens: number | null;
  quotaResetAt: number;
};

export interface AiRequestSchedulerOptions {
  policyFor: (descriptor: AiRequestDescriptor) => AiConcurrencyPolicy;
  globalLimit?: number;
  now?: () => number;
  random?: () => number;
  onSnapshot?: (snapshots: AiConcurrencySnapshot[]) => void;
}

const PRIORITY: Record<AiRequestClass, number> = {
  interactive: 0,
  fusion: 1,
  embedding: 2,
  background: 3,
};

function aborted(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function finiteLimit(value: number, fallback = 1): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(12, Math.floor(value))) : fallback;
}

function statusOf(error: any): number | null {
  const status = Number(error?.status ?? error?.response?.status);
  return Number.isFinite(status) ? status : null;
}

function retryAfterMs(error: any, now = Date.now()): number | null {
  const headers = error?.headers ?? error?.response?.headers;
  const raw = typeof headers?.get === 'function'
    ? headers.get('retry-after') ?? headers.get('x-ratelimit-reset')
    : headers?.['retry-after'] ?? headers?.['x-ratelimit-reset'];
  if (raw == null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    const duration = seconds > 1_000_000_000 ? seconds * 1000 - now : seconds * 1000;
    return Math.max(0, Math.min(15 * 60_000, Math.ceil(duration)));
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(15 * 60_000, parsed - now)) : null;
}

function headerValue(headers: Headers | Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = typeof (headers as Headers)?.get === 'function'
      ? (headers as Headers).get(name)
      : (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function nonNegativeHeader(headers: Headers | Record<string, unknown>, names: string[]): number | null {
  const raw = headerValue(headers, names);
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resetHeaderAt(headers: Headers | Record<string, unknown>, now: number): number {
  const raw = headerValue(headers, [
    'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset',
    'ratelimit-reset', 'retry-after',
  ]);
  if (!raw) return 0;
  const duration = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m|h)$/i);
  if (duration) {
    const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[duration[2].toLowerCase() as 'ms' | 's' | 'm' | 'h'];
    return now + Math.ceil(Number(duration[1]) * multiplier);
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    if (numeric > 1_000_000_000_000) return Math.ceil(numeric);
    if (numeric > 1_000_000_000) return Math.ceil(numeric * 1_000);
    return now + Math.ceil(numeric * 1_000);
  }
  const date = Date.parse(raw);
  return Number.isFinite(date) ? date : 0;
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

/**
 * Process-wide, provider-aware scheduler shared by text and embedding transports.
 * Retries must call `run` for every attempt, so backoff never occupies a slot.
 */
export class AiRequestScheduler {
  #active = 0;
  #sequence = 0;
  #waiting: WaitingRequest[] = [];
  #accounts = new Map<string, AdaptiveState>();
  #models = new Map<string, AdaptiveState>();
  #accountDescriptors = new Map<string, AiRequestDescriptor>();
  #modelDescriptors = new Map<string, AiRequestDescriptor>();
  #modelAccounts = new Map<string, Set<string>>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #globalLimit: number;

  constructor(private readonly options: AiRequestSchedulerOptions) {
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#globalLimit = finiteLimit(options.globalLimit ?? 12, 12);
  }

  run<T>(descriptor: AiRequestDescriptor, task: () => Promise<T>): Promise<T> {
    if (descriptor.signal?.aborted) return Promise.reject(aborted(descriptor.signal));
    // policyFor may read per-vault settings through AsyncLocalStorage. Never call
    // it later from a timer or another request's completion context: that vault
    // connection may already be closed by then.
    const policy = this.options.policyFor(descriptor);
    this.#accountDescriptors.set(this.#accountKey(descriptor), descriptor);
    this.#modelDescriptors.set(this.#modelKey(descriptor), descriptor);
    this.#state(this.#accounts, this.#accountKey(descriptor), descriptor, policy);
    this.#state(this.#models, this.#modelKey(descriptor), descriptor, policy);
    const modelAccounts = this.#modelAccounts.get(this.#modelKey(descriptor)) ?? new Set<string>();
    modelAccounts.add(this.#accountKey(descriptor));
    this.#modelAccounts.set(this.#modelKey(descriptor), modelAccounts);
    return new Promise<T>((resolve, reject) => {
      const waiting: WaitingRequest<T> = {
        descriptor,
        policy,
        sequence: this.#sequence++,
        task,
        resolve,
        reject,
      };
      if (descriptor.signal) {
        waiting.abort = () => {
          const index = this.#waiting.indexOf(waiting as WaitingRequest);
          if (index === -1) return;
          this.#waiting.splice(index, 1);
          reject(aborted(descriptor.signal));
          this.#emitSnapshots();
        };
        descriptor.signal.addEventListener('abort', waiting.abort, { once: true });
      }
      this.#waiting.push(waiting as WaitingRequest);
      this.#drain();
    });
  }

  /**
   * Feed successful response quota headers back into the account bucket. The next
   * dispatch reserves its estimated request/tokens before it starts. Unknown header
   * dialects are ignored and the controller continues with AIMD.
   */
  observeQuota(descriptor: AiRequestDescriptor, headers: Headers | Record<string, unknown>): void {
    const account = this.#state(this.#accounts, this.#accountKey(descriptor), descriptor);
    const requests = nonNegativeHeader(headers, [
      'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-request',
      'ratelimit-remaining-requests', 'ratelimit-remaining',
    ]);
    const tokens = nonNegativeHeader(headers, [
      'x-ratelimit-remaining-tokens', 'ratelimit-remaining-tokens',
    ]);
    const resetAt = resetHeaderAt(headers, this.#now());
    if (requests != null) account.remainingRequests = requests;
    if (tokens != null) account.remainingTokens = tokens;
    if (resetAt > 0) account.quotaResetAt = resetAt;
    if (account.quotaResetAt > this.#now() && (account.remainingRequests === 0 || account.remainingTokens === 0)) {
      account.cooldownUntil = Math.max(account.cooldownUntil, account.quotaResetAt);
      account.lastChangeReason = account.remainingRequests === 0 ? 'request-quota-reserved' : 'token-quota-reserved';
    }
    this.#drain();
  }

  snapshots(): AiConcurrencySnapshot[] {
    const queuedByModel = new Map<string, number>();
    for (const waiting of this.#waiting) {
      const key = this.#modelKey(waiting.descriptor);
      queuedByModel.set(key, (queuedByModel.get(key) ?? 0) + 1);
    }
    return [...this.#models.entries()].map(([key, state]) => {
      const [provider, model] = key.split('\u0000');
      const accountStates = [...(this.#modelAccounts.get(key) ?? [])]
        .map((accountKey) => this.#accounts.get(accountKey))
        .filter((account): account is AdaptiveState => Boolean(account));
      const coolingAccount = accountStates
        .filter((account) => account.cooldownUntil > this.#now())
        .sort((a, b) => b.cooldownUntil - a.cooldownUntil)[0];
      return {
        provider,
        model,
        active: state.active,
        queued: queuedByModel.get(key) ?? 0,
        // This is a provider/model snapshot, so its displayed capacity must be
        // the aggregate model bucket. Each credential bucket is still enforced
        // independently in #drain and can place the model in cooldown, but using
        // the smallest credential limit here can report impossible states such as
        // "5 active / limit 4" when work is spread over two credential scopes.
        currentLimit: state.currentLimit,
        maximumLimit: state.maximumLimit,
        cooldownUntil: Math.max(state.cooldownUntil, coolingAccount?.cooldownUntil ?? 0) > this.#now()
          ? Math.max(state.cooldownUntil, coolingAccount?.cooldownUntil ?? 0)
          : null,
        lastChangeReason: coolingAccount?.lastChangeReason ?? state.lastChangeReason,
      };
    });
  }

  /** Re-read the current application policy without dropping active work. Queued
   * requests adopt it before the next dispatch, which makes Manual → 1 an
   * immediate, database-safe rollback instead of a restart-only setting. */
  reconfigure(): void {
    for (const waiting of this.#waiting) waiting.policy = this.options.policyFor(waiting.descriptor);
    for (const [key, state] of this.#accounts) {
      const descriptor = this.#accountDescriptors.get(key);
      if (descriptor) this.#applyPolicy(state, this.options.policyFor(descriptor));
    }
    for (const [key, state] of this.#models) {
      const descriptor = this.#modelDescriptors.get(key);
      if (descriptor) this.#applyPolicy(state, this.options.policyFor(descriptor));
    }
    this.#drain();
  }

  reset(): void {
    if (this.#active || this.#waiting.length) throw new Error('Cannot reset the AI scheduler while requests are active or queued.');
    this.#accounts.clear();
    this.#models.clear();
    this.#accountDescriptors.clear();
    this.#modelDescriptors.clear();
    this.#modelAccounts.clear();
    this.#clearTimer();
    this.#emitSnapshots();
  }

  #accountKey(descriptor: AiRequestDescriptor): string {
    return [descriptor.provider, descriptor.credentialScope, descriptor.endpoint ?? ''].join('\u0000');
  }

  #modelKey(descriptor: AiRequestDescriptor): string {
    return [descriptor.provider, descriptor.model].join('\u0000');
  }

  #state(
    map: Map<string, AdaptiveState>,
    key: string,
    descriptor: AiRequestDescriptor,
    capturedPolicy?: AiConcurrencyPolicy,
  ): AdaptiveState {
    let state = map.get(key);
    const policy = capturedPolicy ?? (state ? null : this.options.policyFor(descriptor));
    if (!policy && state) return state;
    if (!policy) throw new Error('Missing AI concurrency policy.');
    const manual = finiteLimit(policy.manualLimit);
    const initial = policy.mode === 'manual' ? manual : finiteLimit(policy.initial);
    const maximum = policy.mode === 'manual' ? manual : Math.max(initial, finiteLimit(policy.maximum));
    if (!state) {
      state = {
        mode: policy.mode,
        active: 0,
        currentLimit: initial,
        maximumLimit: maximum,
        successStreak: 0,
        lastThrottleAt: this.#now(),
        lastIncreaseAt: this.#now(),
        cooldownUntil: 0,
        transientFailures: [],
        latencies: [],
        lastChangeReason: policy.mode === 'manual' ? 'manual' : 'initial-safe-limit',
        remainingRequests: null,
        remainingTokens: null,
        quotaResetAt: 0,
      };
      map.set(key, state);
    } else this.#applyPolicy(state, policy);
    return state;
  }

  #applyPolicy(state: AdaptiveState, policy: AiConcurrencyPolicy): void {
    const manual = finiteLimit(policy.manualLimit);
    const initial = policy.mode === 'manual' ? manual : finiteLimit(policy.initial);
    const maximum = policy.mode === 'manual' ? manual : Math.max(initial, finiteLimit(policy.maximum));
    const modeChanged = state.mode !== policy.mode;
    state.mode = policy.mode;
    state.maximumLimit = maximum;
    state.currentLimit = modeChanged ? initial : Math.min(state.currentLimit, maximum);
    if (policy.mode === 'manual') state.currentLimit = manual;
    if (modeChanged) {
      state.successStreak = 0;
      state.transientFailures = [];
      state.cooldownUntil = state.quotaResetAt > this.#now() ? state.quotaResetAt : 0;
      state.lastChangeReason = policy.mode === 'manual' ? 'manual' : 'initial-safe-limit';
    }
  }

  #drain(): void {
    this.#clearTimer();
    this.#waiting.sort((a, b) => PRIORITY[a.descriptor.requestClass] - PRIORITY[b.descriptor.requestClass] || a.sequence - b.sequence);
    let progressed = true;
    while (progressed && this.#waiting.length) {
      progressed = false;
      const interactiveWaiting = this.#waiting.some((item) => item.descriptor.requestClass === 'interactive');
      for (let index = 0; index < this.#waiting.length; index++) {
        const waiting = this.#waiting[index];
        if (waiting.descriptor.signal?.aborted) {
          this.#waiting.splice(index--, 1);
          if (waiting.abort) waiting.descriptor.signal.removeEventListener('abort', waiting.abort);
          waiting.reject(aborted(waiting.descriptor.signal));
          progressed = true;
          continue;
        }
        const account = this.#state(this.#accounts, this.#accountKey(waiting.descriptor), waiting.descriptor, waiting.policy);
        const model = this.#state(this.#models, this.#modelKey(waiting.descriptor), waiting.descriptor, waiting.policy);
        const now = this.#now();
        this.#refreshQuota(account, now);
        if (account.cooldownUntil > now || model.cooldownUntil > now) continue;
        const backgroundCeiling = interactiveWaiting && waiting.descriptor.requestClass !== 'interactive'
          ? Math.max(1, this.#globalLimit - 1)
          : this.#globalLimit;
        if (this.#active >= backgroundCeiling || account.active >= account.currentLimit || model.active >= model.currentLimit) continue;
        if (!this.#canReserveQuota(account, waiting.descriptor, now)) continue;

        this.#waiting.splice(index, 1);
        if (waiting.abort) waiting.descriptor.signal?.removeEventListener('abort', waiting.abort);
        this.#start(waiting, account, model);
        progressed = true;
        break;
      }
    }
    this.#scheduleWakeup();
    this.#emitSnapshots();
  }

  #refreshQuota(state: AdaptiveState, now: number): void {
    if (!state.quotaResetAt || state.quotaResetAt > now) return;
    state.remainingRequests = null;
    state.remainingTokens = null;
    state.quotaResetAt = 0;
    if (state.cooldownUntil <= now && /quota-reserved$/.test(state.lastChangeReason)) {
      state.lastChangeReason = 'quota-window-reset';
    }
  }

  #canReserveQuota(state: AdaptiveState, descriptor: AiRequestDescriptor, now: number): boolean {
    const tokens = Math.max(0, Math.ceil((descriptor.estimatedInputTokens ?? 0) + (descriptor.estimatedOutputTokens ?? 0)));
    const requestBlocked = state.remainingRequests != null && state.remainingRequests < 1;
    const tokenBlocked = state.remainingTokens != null && tokens > 0 && state.remainingTokens < tokens;
    if (requestBlocked || tokenBlocked) {
      if (state.quotaResetAt > now) {
        state.cooldownUntil = Math.max(state.cooldownUntil, state.quotaResetAt);
        state.lastChangeReason = requestBlocked ? 'request-quota-reserved' : 'token-quota-reserved';
        return false;
      }
      // A remaining counter without a reset cannot be scheduled safely forever;
      // fall back to AIMD rather than deadlocking the application.
      state.remainingRequests = null;
      state.remainingTokens = null;
    }
    if (state.remainingRequests != null) state.remainingRequests = Math.max(0, state.remainingRequests - 1);
    if (state.remainingTokens != null && tokens > 0) state.remainingTokens = Math.max(0, state.remainingTokens - tokens);
    return true;
  }

  #start(waiting: WaitingRequest, account: AdaptiveState, model: AdaptiveState): void {
    this.#active += 1;
    account.active += 1;
    model.active += 1;
    const startedAt = this.#now();
    Promise.resolve()
      .then(() => {
        waiting.descriptor.signal?.throwIfAborted();
        return waiting.task();
      })
      .then(
        (value) => {
          const latency = Math.max(0, this.#now() - startedAt);
          this.#recordSuccess(account, latency, waiting.descriptor);
          this.#recordSuccess(model, latency, waiting.descriptor);
          waiting.resolve(value);
        },
        (error) => {
          this.#recordFailure(account, error);
          this.#recordFailure(model, error);
          waiting.reject(error);
        },
      )
      .finally(() => {
        this.#active -= 1;
        account.active -= 1;
        model.active -= 1;
        this.#drain();
      });
  }

  #recordSuccess(state: AdaptiveState, latency: number, descriptor: AiRequestDescriptor): void {
    if (state.mode !== 'automatic') return;
    const reference = state.latencies.length >= 10 ? percentile95(state.latencies) : 0;
    state.latencies.push(latency);
    if (state.latencies.length > 100) state.latencies.shift();
    state.successStreak += 1;
    const now = this.#now();
    const saturated = this.#waiting.some((item) =>
      this.#accountKey(item.descriptor) === this.#accountKey(descriptor) ||
      this.#modelKey(item.descriptor) === this.#modelKey(descriptor));
    const latencyHealthy = reference > 0 && percentile95(state.latencies) <= reference * 1.25;
    if (
      state.successStreak >= 20 && saturated &&
      now - state.lastThrottleAt >= 120_000 && now - state.lastIncreaseAt >= 60_000 &&
      latencyHealthy && state.currentLimit < state.maximumLimit
    ) {
      state.currentLimit += 1;
      state.successStreak = 0;
      state.lastIncreaseAt = now;
      state.lastChangeReason = 'healthy-saturated-queue';
    }
  }

  #recordFailure(state: AdaptiveState, error: any): void {
    state.successStreak = 0;
    const status = statusOf(error);
    const now = this.#now();
    const isTimeout = status === 408 || error?.name?.includes?.('Timeout') || /timeout|timed out/i.test(error?.message ?? '');
    const throttled = status === 429 || status === 529;
    const transient = isTimeout || (status != null && status >= 500 && status < 600);
    if (throttled) {
      this.#halve(state, now, status === 529 ? 'provider-overloaded-529' : 'rate-limited-429');
      const base = retryAfterMs(error, now) ?? 3_000;
      state.cooldownUntil = Math.max(state.cooldownUntil, now + base + Math.floor(base * 0.2 * this.#random()));
      return;
    }
    if (transient) {
      state.transientFailures = state.transientFailures.filter((timestamp) => now - timestamp <= 30_000);
      state.transientFailures.push(now);
      if (state.transientFailures.length >= 2) {
        this.#halve(state, now, isTimeout ? 'repeated-timeout' : `repeated-${status ?? 'network'}-error`);
        state.transientFailures = [];
      }
    }
  }

  #halve(state: AdaptiveState, now: number, reason: string): void {
    state.currentLimit = Math.max(1, Math.ceil(state.currentLimit / 2));
    state.lastThrottleAt = now;
    state.lastChangeReason = reason;
  }

  #scheduleWakeup(): void {
    if (!this.#waiting.length) return;
    const now = this.#now();
    let earliest = Number.POSITIVE_INFINITY;
    for (const waiting of this.#waiting) {
      const account = this.#state(this.#accounts, this.#accountKey(waiting.descriptor), waiting.descriptor, waiting.policy);
      const model = this.#state(this.#models, this.#modelKey(waiting.descriptor), waiting.descriptor, waiting.policy);
      const cooldown = Math.max(account.cooldownUntil, model.cooldownUntil);
      if (cooldown > now) earliest = Math.min(earliest, cooldown);
    }
    if (Number.isFinite(earliest)) {
      this.#timer = setTimeout(() => this.#drain(), Math.max(1, earliest - now));
      this.#timer.unref?.();
    }
  }

  #clearTimer(): void {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #emitSnapshots(): void {
    this.options.onSnapshot?.(this.snapshots());
  }
}

/** Compatibility wrapper for callers that only need a fixed FIFO limit. */
export class AiRequestGate {
  readonly #scheduler: AiRequestScheduler;

  constructor(configuredLimit: () => number) {
    this.#scheduler = new AiRequestScheduler({
      globalLimit: 8,
      policyFor: () => ({
        mode: 'manual',
        initial: configuredLimit(),
        maximum: configuredLimit(),
        manualLimit: configuredLimit(),
      }),
    });
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.#scheduler.run({
      provider: 'legacy', model: 'legacy', credentialScope: 'legacy',
      requestClass: 'background', signal,
    }, task);
  }
}
