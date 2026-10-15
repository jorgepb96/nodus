import { AsyncLocalStorage } from 'node:async_hooks';

const mobile = new AsyncLocalStorage<boolean>();
const grants = new AsyncLocalStorage<readonly string[]>();
/** The requesting device may research existing content, but cannot queue document
 * extraction or indexing as a side effect of a write or a research operation. */
export function withMobileOperation<T>(run: () => T, domains?: readonly string[]): T {
  return mobile.run(true, () => domains ? grants.run(domains, run) : run());
}
/** Existing Desktop callers retain access. A paired operation only reads its grant. */
export function mobileDomainAllowed(domain: string): boolean { return !grants.getStore() || grants.getStore()!.includes(domain); }
export function withDesktopOperation<T>(run: () => T): T { return mobile.exit(run); }
export function isMobileOperation(): boolean { return mobile.getStore() === true; }
export function assertDesktopPreparation(): void {
  if (isMobileOperation()) throw new Error('desktop_preparation_required');
}
