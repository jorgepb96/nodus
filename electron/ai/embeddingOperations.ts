/** Abort pending provider operations before an index is deleted. Index switches leave
 * captured queries alone; their original generation remains available to finish. */
const operations = new Map<string, Set<AbortController>>();
const key = (scope: string, id: string) => JSON.stringify([scope, id]);
export function beginEmbeddingOperation(config: { scope?: string; indexId?: string }, caller?: AbortSignal): { signal: AbortSignal | undefined; release: () => void } {
  if (!config.scope || !config.indexId) return { signal: caller, release: () => {} };
  const identity = key(config.scope, config.indexId);
  const controller = new AbortController();
  const pending = operations.get(identity) ?? new Set<AbortController>();
  pending.add(controller); operations.set(identity, pending);
  return { signal: caller ? AbortSignal.any([caller, controller.signal]) : controller.signal,
    release: () => { pending.delete(controller); if (!pending.size) operations.delete(identity); } };
}
export function cancelEmbeddingIndexOperations(scope: string, id: string): void {
  for (const controller of operations.get(key(scope, id)) ?? []) controller.abort(new DOMException('Embedding index deleted', 'AbortError'));
}
