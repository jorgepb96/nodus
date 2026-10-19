export interface RerankCandidate { id: string; text: string; index_key: string }
export interface RerankResult {
  state: 'applied' | 'unavailable' | 'timeout' | 'failed' | 'off';
  candidates: number;
  durationMs: number;
  order?: RerankCandidate[];
}
/** A bounded second stage. Failure preserves the original hybrid ordering. No
 * model download, embedding regeneration or provider request is initiated here. */
export async function rerankDocumentaryCandidates(query: string, candidates: RerankCandidate[],
  rerank: (query: string, texts: string[], signal?: AbortSignal) => Promise<number[] | null>, signal?: AbortSignal, timeoutMs = 12_000): Promise<RerankResult> {
  signal?.throwIfAborted();
  const started = performance.now();
  const pool = candidates.slice(0, 30);
  if (pool.length < 2) return { state: 'off', candidates: pool.length, durationMs: 0 };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('reranking_timeout')), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let abort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(combined.reason); combined.addEventListener('abort', abort, { once: true }); });
    const scores = await Promise.race([rerank(query, pool.map(candidate => candidate.text.slice(0, 4000)), combined), cancelled]);
    signal?.throwIfAborted();
    const durationMs = performance.now() - started;
    if (!scores) return { state: 'unavailable', candidates: pool.length, durationMs };
    if (scores.length !== pool.length || !scores.every(Number.isFinite)) return { state: 'failed', candidates: pool.length, durationMs };
    return { state: 'applied', candidates: pool.length, durationMs,
      order: pool.map((candidate, index) => ({ candidate, index, score: scores[index] })).sort((a, b) => b.score - a.score || a.index - b.index)
        .map(({ candidate }) => ({ id: candidate.id, text: candidate.text, index_key: candidate.index_key })) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { state: controller.signal.aborted ? 'timeout' : 'failed', candidates: pool.length, durationMs: performance.now() - started };
  } finally { clearTimeout(timeout); if (abort) combined.removeEventListener('abort', abort); }
}
