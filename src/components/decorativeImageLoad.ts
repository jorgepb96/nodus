// Covers can contain large data URLs. Reserve at most three reads before
// starting their bridge deadlines; a gallery must not flood the mobile link.
let activeReads = 0;
const waiting: Array<() => void> = [];
const maximumReads = 3;

export async function readDecorativeImage<T>(read: () => Promise<T>, isMounted: () => boolean): Promise<T | null> {
  if (activeReads < maximumReads) activeReads += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    if (!isMounted()) return null;
    return await read();
  } finally {
    // Transfer this reservation directly to the next waiter; new arrivals
    // cannot overtake it while its continuation is waiting for a microtask.
    const next = waiting.shift();
    if (next) next();
    else activeReads -= 1;
  }
}
