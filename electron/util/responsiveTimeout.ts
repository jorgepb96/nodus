import { performance } from 'node:perf_hooks';

/** A startup budget counts only while the host can deliver the child's events.
 * A long pause in the parent's loop must give queued spawn/IPC events a turn
 * before the child can be declared unresponsive. A genuinely absent child still
 * expires after the budget while the host is responsive. */
export function responsiveTimeout(callback: () => void, timeoutMs: number): () => void {
  let remaining = timeoutMs;
  let last = performance.now();
  let stopped = false;
  let stalled = false;
  let timer: NodeJS.Timeout;
  const arm = () => {
    const delay = Math.min(250, remaining);
    timer = setTimeout(() => {
      if (stopped) return;
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      // A tick more than twice late is a host stall: forgive it once so the child still
      // gets a turn. Consecutive late ticks are a saturated host, where time does pass,
      // so each one spends its nominal delay. Otherwise the deadline could never expire.
      const late = elapsed > delay * 2;
      if (!late) remaining -= elapsed;
      else if (stalled) remaining -= delay;
      stalled = late;
      if (remaining <= 0) { stopped = true; callback(); }
      else arm();
    }, delay);
    timer.unref?.();
  };
  arm();
  return () => { stopped = true; clearTimeout(timer); };
}
