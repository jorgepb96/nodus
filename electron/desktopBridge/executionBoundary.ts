import { AsyncLocalStorage } from 'node:async_hooks';

const mobile = new AsyncLocalStorage<boolean>();
/** The requesting device may research existing content, but cannot queue document
 * extraction or indexing as a side effect of a write or a research operation. */
export function withMobileOperation<T>(run: () => T): T { return mobile.run(true, run); }
export function withDesktopOperation<T>(run: () => T): T { return mobile.exit(run); }
export function isMobileOperation(): boolean { return mobile.getStore() === true; }
export function assertDesktopPreparation(): void {
  if (isMobileOperation()) throw new Error('desktop_preparation_required');
}
