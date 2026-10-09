/**
 * Yield control back to the Electron main-process event loop so pending IPC
 * calls, timers and progress emits can be serviced before more CPU work runs.
 *
 * `better-sqlite3` and the JS `vec_cosine()` similarity function are fully
 * synchronous, and the main process is single-threaded and shared with every
 * IPC handler. A long CPU-bound loop (e.g. a per-idea similarity scan over the
 * whole corpus) therefore freezes the entire app — the renderer can't get IPC
 * responses, so section switches and scan progress appear hung — until the loop
 * finishes. Awaiting this periodically breaks such a loop into chunks and lets
 * the UI stay responsive; it does not change any results.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * How many iterations of a hot main-thread loop to run between event-loop
 * yields. Small enough that each synchronous chunk stays well under a frame,
 * large enough that the yield overhead is negligible.
 */
export const YIELD_EVERY = 16;

/** `task` for every item, at most `limit` at a time, results in the items' order. A failed item is
 *  null rather than failing the rest: one molecule's tool failure used to lose its whole batch. */
export async function eachBounded<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  const lane = async () => {
    for (let index = next++; index < items.length; index = next++) {
      try { out[index] = await task(items[index]); } catch { out[index] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, lane));
  return out;
}
