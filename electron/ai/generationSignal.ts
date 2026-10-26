import { AsyncLocalStorage } from 'node:async_hooks';

const signals = new AsyncLocalStorage<AbortSignal>();
export function withGenerationSignal<T>(signal: AbortSignal, run: () => T): T { return signals.run(signal, run); }
export function generationSignal(explicit?: AbortSignal): AbortSignal | undefined {
  const current = signals.getStore();
  return current && explicit && current !== explicit ? AbortSignal.any([current, explicit]) : explicit ?? current;
}
