/**
 * A reasoning model sometimes loops in its thinking until the output ceiling and never writes
 * the answer (DeepSeek Flash at high effort: 2 of 36 route drafts, each on a target that answered
 * normally in its other runs). `write` is tried once more; any other error, a second cut-off or a
 * cancelled turn is thrown as before.
 *
 * The retry is told it IS the retry, because repeating the request unchanged reproduces the
 * failure when the cause is the thinking budget rather than luck. Measured 2026-10-12 on four hard
 * synthesis targets at thinking high: every one spent the whole 149,422-token ceiling on reasoning,
 * this retry fired on all four — the log line below appears four times — and all four hit the
 * ceiling again and returned nothing. That was 55% of an 11,887 s suite spent on four answers that
 * were never written. The caller lowers the effort on the second attempt, which is the only lever
 * that leaves room for the answer: the ceiling is the model's own and cannot be raised, and a
 * smaller budget only truncates sooner.
 */
export async function retryOnceWhenCutOff<T>(
  write: (isRetry: boolean) => Promise<T>,
  options: { isCutOff: (error: unknown) => boolean; beforeRetry?: () => void; signal?: AbortSignal },
): Promise<T> {
  try {
    return await write(false);
  } catch (error) {
    if (options.signal?.aborted || !options.isCutOff(error)) throw error;
    console.warn('[research] answer cut off at the output limit; retrying once');
    options.beforeRetry?.();
    return write(true);
  }
}
