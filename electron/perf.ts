export interface PerfContext {
  nodusId?: string | null;
  title?: string | null;
}

export type PerfMeta = Record<string, string | number | boolean | null | undefined>;
let perfSequence = 0;

function appendPerfEvent(
  phase: string,
  durationNs: bigint,
  ctx: PerfContext,
  meta?: PerfMeta,
): void {
  const target = process.env.NODUS_PERF_JSONL?.trim();
  if (!target) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify({
      schema: 'nodus-perf/1',
      sequence: perfSequence++,
      timestamp: new Date().toISOString(),
      phase,
      durationNs: durationNs.toString(),
      durationMs: Number(durationNs) / 1_000_000,
      nodusId: ctx.nodusId ?? null,
      // Deliberately omit titles, prompts, documents, keys and responses.
      meta: Object.fromEntries(Object.entries(meta ?? {}).filter(([, value]) => value !== undefined)),
      rssBytes: process.memoryUsage().rss,
    })}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn('[perf] No se pudo escribir la telemetría local:', error instanceof Error ? error.message : String(error));
  }
}

function shortTitle(title?: string | null): string {
  if (!title) return '';
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

function formatMeta(meta?: PerfMeta): string {
  if (!meta) return '';
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function perfLog(phase: string, durationMs: number, ctx: PerfContext = {}, meta?: PerfMeta): void {
  const target = [ctx.nodusId, shortTitle(ctx.title)].filter(Boolean).join(' ');
  const targetPart = target ? ` ${target}` : '';
  console.log(`[perf][deep] ${phase}${targetPart} ${Math.round(durationMs)}ms${formatMeta(meta)}`);
  appendPerfEvent(phase, BigInt(Math.max(0, Math.round(durationMs * 1_000_000))), ctx, meta);
}

export function perfLogNs(phase: string, durationNs: bigint, ctx: PerfContext = {}, meta?: PerfMeta): void {
  const target = [ctx.nodusId, shortTitle(ctx.title)].filter(Boolean).join(' ');
  const targetPart = target ? ` ${target}` : '';
  console.log(`[perf][deep] ${phase}${targetPart} ${Math.round(Number(durationNs) / 1_000_000)}ms${formatMeta(meta)}`);
  appendPerfEvent(phase, durationNs, ctx, meta);
}

export function startPerf(phase: string, ctx: PerfContext = {}, meta?: PerfMeta): (extra?: PerfMeta) => void {
  const start = process.hrtime.bigint();
  let logged = false;
  return (extra?: PerfMeta) => {
    if (logged) return;
    logged = true;
    const durationNs = process.hrtime.bigint() - start;
    const merged = { ...meta, ...extra };
    perfLogNs(phase, durationNs, ctx, merged);
  };
}

export async function measurePerf<T>(
  phase: string,
  ctx: PerfContext,
  fn: () => Promise<T>,
  meta?: PerfMeta
): Promise<T> {
  const done = startPerf(phase, ctx, meta);
  try {
    const result = await fn();
    done();
    return result;
  } catch (e) {
    done({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * With `NODUS_PERF_JSONL` set, sample the main process loop and log every stretch
 * that misses its timer by more than `thresholdMs`. A late timer means synchronous
 * work held the loop; the acceptance run for narration requires no block over
 * 50 ms, because that is what the user sees as a frozen window or a beachball.
 */
export function startEventLoopBlockWatch(thresholdMs = 50, intervalMs = 100): () => void {
  const target = process.env.NODUS_PERF_JSONL?.trim();
  if (!target || thresholdMs <= 0 || intervalMs <= 0) return () => {};
  let last = performance.now();
  let lastCpu = process.cpuUsage();
  const timer = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage(lastCpu);
    const lag = now - last - intervalMs;
    const cpuMs = (cpu.user + cpu.system) / 1_000;
    // A late timer with almost no CPU is the OS coalescing or napping the process,
    // not synchronous work holding the loop. Only a busy delay is a real block.
    if (lag > thresholdMs && cpuMs > thresholdMs / 2) perfLog('event-loop-block', lag, {}, { thresholdMs, intervalMs, cpuMs });
    last = now;
    lastCpu = process.cpuUsage();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Opt-in companion for a perf run: wraps `setInterval` so a slow timer callback
 * records its duration, interval and registration site. The block watch says
 * *that* the loop stalled; this says *which* recurring job did it.
 */
export function instrumentIntervalCallbacks(minDurationMs = 8): () => void {
  if (!process.env.NODUS_PERF_JSONL?.trim() || process.env.NODUS_PERF_TRACE_TIMERS !== '1') return () => {};
  const original = global.setInterval;
  global.setInterval = ((callback: (...values: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (typeof callback !== 'function') return original(callback as never, delay, ...args);
    const origin = (new Error().stack ?? '').split('\n').slice(2, 5).map((line) => line.trim()).join(' | ');
    const wrapped = (...called: unknown[]) => {
      const started = performance.now();
      try { return callback(...called); }
      finally {
        const took = performance.now() - started;
        if (took >= minDurationMs) perfLog('interval-callback', took, {}, { intervalMs: Number(delay) || 0, origin });
      }
    };
    return original(wrapped, delay, ...args);
  }) as typeof global.setInterval;
  return () => { global.setInterval = original; };
}
import fs from 'node:fs';
import path from 'node:path';
