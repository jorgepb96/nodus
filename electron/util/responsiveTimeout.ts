import { performance } from 'node:perf_hooks';

type Timer = { unref?: () => unknown };

/** Clock and scheduler, injectable so tests can model a slow host without wall-clock thresholds. */
export type ResponsiveTimeoutHost = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => Timer;
  clearTimeout: (timer: Timer) => void;
};

const realHost: ResponsiveTimeoutHost = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: timer => clearTimeout(timer as NodeJS.Timeout),
};

/** A startup budget counts only while the host can deliver the child's events.
 * A long pause in the parent's loop must give queued spawn/IPC events a turn
 * before the child can be declared unresponsive. A genuinely absent child still
 * expires after the budget while the host is responsive. A late tick spends at
 * most two ticks of budget, so a host that is late on every tick still expires
 * the budget instead of postponing it forever. */
export function responsiveTimeout(callback: () => void, timeoutMs: number, host: ResponsiveTimeoutHost = realHost): () => void {
  let remaining = timeoutMs;
  let last = host.now();
  let stopped = false;
  let graced = false;
  let timer: Timer;
  const arm = (delay: number) => {
    timer = host.setTimeout(() => {
      if (stopped) return;
      const now = host.now();
      const elapsed = now - last;
      last = now;
      const stalled = elapsed > delay * 2;
      remaining -= Math.min(elapsed, delay * 2);
      // A stall that exhausts the budget grants the child's events one more tick.
      if (remaining <= 0 && (graced || !stalled)) { stopped = true; callback(); return; }
      if (remaining <= 0) graced = true;
      arm(graced ? delay : Math.min(250, remaining));
    }, delay);
    timer.unref?.();
  };
  arm(Math.min(250, remaining));
  return () => { stopped = true; host.clearTimeout(timer); };
}
